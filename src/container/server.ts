import { Effect, ManagedRuntime, Result, Schema } from "effect";

import { parseGameTypeQuery } from "./game-type.ts";
import { mapGameDigError } from "./gamedig/errors.ts";
import { GameDigService } from "./gamedig/service.ts";
import type { QueryParams } from "./query-params.ts";
import {
  findSensitiveQueryParameter,
  parsePostQuery,
  parseQueryParams,
  PostQueryRequestSchema,
  toPublicQueryParams,
} from "./query-params.ts";
import { MAX_POST_BODY_BYTES } from "./request-limits.ts";
import {
  applyTargetPolicy,
  DEFAULT_TARGET_POLICY_MODE,
  type TargetPolicyMode,
} from "./target-policy.ts";

const runtime = ManagedRuntime.make(GameDigService.layer);
const taggedError = Schema.TaggedError;

class InvalidJsonError extends taggedError<InvalidJsonError>()("InvalidJson", {
  message: Schema.String,
}) {}

class PayloadTooLargeError extends taggedError<PayloadTooLargeError>()(
  "PayloadTooLarge",
  { message: Schema.String }
) {}

type ExecuteQuery = (query: QueryParams) => Response | Promise<Response>;

const respondJson = <T>(body: T, status = 200): Response =>
  Response.json(body, {
    headers: { "cache-control": "no-store" },
    status,
  });

const invalidQueryResponse = (message: string, type = "InvalidQuery") =>
  respondJson(
    {
      error: { message, type },
      success: false,
    },
    400
  );

const payloadTooLarge = () =>
  new PayloadTooLargeError({
    message: `POST /query body exceeds ${MAX_POST_BODY_BYTES} bytes`,
  });

const payloadTooLargeResponse = (error: PayloadTooLargeError) =>
  respondJson(
    {
      error: { message: error.message, type: error._tag },
      success: false,
    },
    413
  );

const parseJson = (text: string): Result.Result<unknown, InvalidJsonError> => {
  try {
    const value: unknown = JSON.parse(text);
    return Result.succeed(value);
  } catch {
    return Result.fail(
      new InvalidJsonError({ message: "Malformed JSON request body" })
    );
  }
};

const readPostBody = async (
  request: Request
): Promise<Result.Result<string, InvalidJsonError | PayloadTooLargeError>> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_POST_BODY_BYTES) {
      return Result.fail(payloadTooLarge());
    }
  }

  if (request.body === null) {
    return Result.succeed("");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_POST_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return Result.fail(payloadTooLarge());
      }
      chunks.push(chunk.value);
    }
  } catch {
    return Result.fail(
      new InvalidJsonError({ message: "Unable to read JSON request body" })
    );
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return Result.succeed(new TextDecoder().decode(bytes));
};

const hasJsonContentType = (request: Request): boolean =>
  request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";

const runQuery = (query: QueryParams): Promise<Response> =>
  runtime.runPromise(
    Effect.gen(function* queryGameServer() {
      const gameDig = yield* GameDigService;
      return yield* gameDig.query(query);
    }).pipe(
      Effect.match({
        onFailure: (error) => {
          const status = error.kind === "response" ? 502 : 504;
          return respondJson(mapGameDigError(error), status);
        },
        onSuccess: (server) =>
          respondJson({
            query: toPublicQueryParams(query),
            server,
            success: true,
          }),
      })
    )
  );

export const makeRequestHandler =
  (
    executeQuery: ExecuteQuery,
    targetPolicyMode: TargetPolicyMode = DEFAULT_TARGET_POLICY_MODE
  ) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    const executeParsedQuery = (query: QueryParams) => {
      const parsedGameType = parseGameTypeQuery(query);
      if (Result.isFailure(parsedGameType)) {
        return invalidQueryResponse(
          parsedGameType.failure.message,
          parsedGameType.failure._tag
        );
      }

      const allowedTarget = applyTargetPolicy(
        parsedGameType.success,
        targetPolicyMode
      );
      if (Result.isFailure(allowedTarget)) {
        return invalidQueryResponse(
          allowedTarget.failure.message,
          allowedTarget.failure._tag
        );
      }

      return executeQuery(allowedTarget.success);
    };

    if (
      request.method !== "GET" &&
      !(request.method === "POST" && url.pathname === "/query")
    ) {
      return respondJson(
        {
          error: { message: "Use GET", type: "MethodNotAllowed" },
          success: false,
        },
        405
      );
    }

    switch (url.pathname) {
      case "/health": {
        return respondJson({ service: "cf-gamedig-container", success: true });
      }
      case "/query": {
        if (request.method === "GET") {
          const sensitiveParameter = findSensitiveQueryParameter(
            url.searchParams
          );
          if (sensitiveParameter !== undefined) {
            return invalidQueryResponse(
              `Sensitive option ${sensitiveParameter} must be sent with POST /query JSON`
            );
          }

          const query = parseQueryParams(url.searchParams);
          if (Result.isFailure(query)) {
            return invalidQueryResponse(
              query.failure.message,
              query.failure._tag
            );
          }
          return executeParsedQuery(query.success);
        }

        if (!hasJsonContentType(request)) {
          return respondJson(
            {
              error: {
                message: "POST /query requires Content-Type: application/json",
                type: "UnsupportedMediaType",
              },
              success: false,
            },
            415
          );
        }

        const body = await readPostBody(request);
        if (Result.isFailure(body)) {
          return body.failure._tag === "PayloadTooLarge"
            ? payloadTooLargeResponse(body.failure)
            : invalidQueryResponse(body.failure.message, body.failure._tag);
        }

        const json = parseJson(body.success);
        if (Result.isFailure(json)) {
          return invalidQueryResponse(json.failure.message, json.failure._tag);
        }

        const postRequest = Schema.decodeUnknownResult(PostQueryRequestSchema)(
          json.success
        );
        if (Result.isFailure(postRequest)) {
          return invalidQueryResponse("Invalid POST /query body");
        }

        const query = parsePostQuery(postRequest.success);
        if (Result.isFailure(query)) {
          return invalidQueryResponse(
            query.failure.message,
            query.failure._tag
          );
        }
        return executeParsedQuery(query.success);
      }
      default: {
        return respondJson(
          {
            error: { message: "Route not found", type: "NotFound" },
            success: false,
          },
          404
        );
      }
    }
  };

export const makeContainerRequestHandler = (targetPolicyMode: TargetPolicyMode) =>
  makeRequestHandler(runQuery, targetPolicyMode);

export const handleRequest = makeContainerRequestHandler(
  DEFAULT_TARGET_POLICY_MODE
);

export const disposeRuntime = (): Promise<void> => runtime.dispose();
