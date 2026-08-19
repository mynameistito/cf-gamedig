import { Effect, ManagedRuntime, Result, Schema } from "effect";

import {
  makeHttpCompletionMetadata,
  readInternalRequestId,
  withRequestIdHeader,
} from "../request-correlation.ts";
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
import { PayloadTooLargeError } from "./request-errors.ts";
import { MAX_POST_BODY_BYTES, MAX_POST_BODY_CHUNKS } from "./request-limits.ts";
import {
  applyTargetPolicy,
  DEFAULT_TARGET_POLICY_MODE,
} from "./target-policy.ts";
import type { TargetPolicyMode } from "./target-policy.ts";

const runtime = ManagedRuntime.make(GameDigService.layer);
const taggedError = Schema.TaggedError;

class InvalidJsonError extends taggedError<InvalidJsonError>()("InvalidJson", {
  message: Schema.String,
}) {}

interface RequestContext {
  readonly requestId?: string;
}

type ExecuteQuery = (
  query: QueryParams,
  context: RequestContext
) => Response | Promise<Response>;
type ExecuteParsedQuery = (query: QueryParams) => Response | Promise<Response>;

interface CollectedBody {
  readonly byteLength: number;
  readonly chunks: Uint8Array[];
}

interface CancelableReadable {
  readonly cancel: () => Promise<void>;
}

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

const payloadTooFragmented = () =>
  new PayloadTooLargeError({
    message: `POST /query body exceeds ${MAX_POST_BODY_CHUNKS} chunks`,
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

const readBodyChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>
) => {
  try {
    return Result.succeed(await reader.read());
  } catch {
    return Result.fail(
      new InvalidJsonError({ message: "Unable to read JSON request body" })
    );
  }
};

const readBodyChunks = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  collected: CollectedBody
): Promise<
  Result.Result<CollectedBody, InvalidJsonError | PayloadTooLargeError>
> => {
  const chunk = await readBodyChunk(reader);
  if (Result.isFailure(chunk)) {
    return Result.fail(chunk.failure);
  }

  if (chunk.success.done) {
    return Result.succeed(collected);
  }

  const byteLength = collected.byteLength + chunk.success.value.byteLength;
  if (byteLength > MAX_POST_BODY_BYTES) {
    return Result.fail(payloadTooLarge());
  }
  if (collected.chunks.length >= MAX_POST_BODY_CHUNKS) {
    return Result.fail(payloadTooFragmented());
  }

  collected.chunks.push(chunk.success.value);
  return readBodyChunks(reader, {
    byteLength,
    chunks: collected.chunks,
  });
};

const decodeBody = ({ byteLength, chunks }: CollectedBody): string => {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

const cancelReadable = async (readable: CancelableReadable): Promise<void> => {
  try {
    await readable.cancel();
  } catch {
    // Cancellation is best-effort cleanup after the request has already failed.
  }
};

const readPostBody = async (
  request: Request
): Promise<Result.Result<string, InvalidJsonError | PayloadTooLargeError>> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_POST_BODY_BYTES) {
      if (request.body !== null) {
        await cancelReadable(request.body);
      }
      return Result.fail(payloadTooLarge());
    }
  }

  if (request.body === null) {
    return Result.succeed("");
  }

  const reader = request.body.getReader();
  try {
    const body = await readBodyChunks(reader, { byteLength: 0, chunks: [] });
    if (Result.isFailure(body)) {
      await cancelReadable(reader);
      return Result.fail(body.failure);
    }
    return Result.succeed(decodeBody(body.success));
  } finally {
    reader.releaseLock();
  }
};

const hasJsonContentType = (request: Request): boolean =>
  request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";

const runQuery: ExecuteQuery = (query, context) => {
  const program = Effect.gen(function* queryGameServer() {
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
  );

  return runtime.runPromise(
    context.requestId === undefined
      ? program
      : program.pipe(Effect.annotateLogs("requestId", context.requestId))
  );
};

const executeValidatedQuery = (
  query: QueryParams,
  executeQuery: ExecuteQuery,
  targetPolicyMode: TargetPolicyMode,
  context: RequestContext
): Response | Promise<Response> => {
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

  return executeQuery(allowedTarget.success, context);
};

const handleGetQuery = (
  searchParams: URLSearchParams,
  executeQuery: ExecuteParsedQuery
): Response | Promise<Response> => {
  const sensitiveParameter = findSensitiveQueryParameter(searchParams);
  if (sensitiveParameter !== undefined) {
    return invalidQueryResponse(
      `Sensitive option ${sensitiveParameter} must be sent with POST /query JSON`
    );
  }

  const query = parseQueryParams(searchParams);
  if (Result.isFailure(query)) {
    return invalidQueryResponse(query.failure.message, query.failure._tag);
  }
  return executeQuery(query.success);
};

const handlePostQuery = async (
  request: Request,
  executeQuery: ExecuteParsedQuery
): Promise<Response> => {
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
    return invalidQueryResponse(query.failure.message, query.failure._tag);
  }
  return executeQuery(query.success);
};

const methodNotAllowed = (allowedMethods: readonly string[]) => {
  const allow = allowedMethods.join(", ");
  const response = respondJson(
    {
      error: { message: `Use ${allow}`, type: "MethodNotAllowed" },
      success: false,
    },
    405
  );
  response.headers.set("allow", allow);
  return response;
};

const routeRequest = (
  request: Request,
  executeQuery: ExecuteQuery,
  targetPolicyMode: TargetPolicyMode,
  context: RequestContext
): Response | Promise<Response> => {
  const url = new URL(request.url);
  const executeParsedQuery: ExecuteParsedQuery = (query) =>
    executeValidatedQuery(query, executeQuery, targetPolicyMode, context);

  if (url.pathname === "/health") {
    return request.method === "GET"
      ? respondJson({ service: "cf-gamedig-container", success: true })
      : methodNotAllowed(["GET"]);
  }

  if (url.pathname !== "/query") {
    return request.method === "GET"
      ? respondJson(
          {
            error: { message: "Route not found", type: "NotFound" },
            success: false,
          },
          404
        )
      : methodNotAllowed(["GET"]);
  }

  if (request.method === "GET") {
    return handleGetQuery(url.searchParams, executeParsedQuery);
  }
  if (request.method === "POST") {
    return handlePostQuery(request, executeParsedQuery);
  }
  return methodNotAllowed(["GET", "POST"]);
};

export const makeRequestHandler =
  (
    executeQuery: ExecuteQuery,
    targetPolicyMode: TargetPolicyMode = DEFAULT_TARGET_POLICY_MODE
  ) =>
  async (request: Request): Promise<Response> => {
    const requestId = readInternalRequestId(request);
    const context: RequestContext =
      requestId === undefined ? {} : { requestId };
    const response = await routeRequest(
      request,
      executeQuery,
      targetPolicyMode,
      context
    );

    return requestId === undefined
      ? response
      : withRequestIdHeader(response, requestId);
  };

export const makeContainerRequestHandler = (
  targetPolicyMode: TargetPolicyMode
) => {
  const handler = makeRequestHandler(runQuery, targetPolicyMode);

  return async (request: Request): Promise<Response> => {
    const startedAt = Date.now();
    const response = await handler(request);
    const requestId = readInternalRequestId(request);
    const metadata = makeHttpCompletionMetadata(
      request,
      response,
      Date.now() - startedAt,
      requestId
    );

    await runtime.runPromise(
      Effect.logInfo("Container HTTP request completed").pipe(
        Effect.annotateLogs({ event: "container_http_completed", ...metadata })
      )
    );

    return response;
  };
};

export const handleRequest = makeContainerRequestHandler(
  DEFAULT_TARGET_POLICY_MODE
);

export const disposeRuntime = (): Promise<void> => runtime.dispose();
