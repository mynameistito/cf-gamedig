import { Effect, ManagedRuntime, Result, Schema } from "effect";

import { mapGameDigError } from "./gamedig/errors.ts";
import { GameDigService } from "./gamedig/service.ts";
import type { QueryParams } from "./query-params.ts";
import {
  findSensitiveQueryParameter,
  parsePostQuery,
  parseQueryParams,
  toPublicQueryParams,
} from "./query-params.ts";

const runtime = ManagedRuntime.make(GameDigService.layer);
const taggedError = Schema.TaggedError;

class InvalidJsonError extends taggedError<InvalidJsonError>()("InvalidJson", {
  message: Schema.String,
}) {}

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

export const makeRequestHandler = (executeQuery: ExecuteQuery) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (request.method !== "GET" && !(request.method === "POST" && url.pathname === "/query")) {
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
          const sensitiveParameter = findSensitiveQueryParameter(url.searchParams);
          if (sensitiveParameter !== undefined) {
            return invalidQueryResponse(
              `Sensitive option ${sensitiveParameter} must be sent with POST /query JSON`
            );
          }

          const query = parseQueryParams(url.searchParams);
          if (Result.isFailure(query)) {
            return invalidQueryResponse(query.failure.message, query.failure._tag);
          }
          return executeQuery(query.success);
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

        const json = parseJson(await request.text());
        if (Result.isFailure(json)) {
          return invalidQueryResponse(json.failure.message, json.failure._tag);
        }

        const query = parsePostQuery(json.success);
        if (Result.isFailure(query)) {
          return invalidQueryResponse(query.failure.message, query.failure._tag);
        }
        return executeQuery(query.success);
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

export const handleRequest = makeRequestHandler(runQuery);

export const disposeRuntime = (): Promise<void> => runtime.dispose();
