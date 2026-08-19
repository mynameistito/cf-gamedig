import { Effect, ManagedRuntime, Result } from "effect";

import { mapGameDigError } from "./gamedig/errors.ts";
import { GameDigService } from "./gamedig/service.ts";
import type { QueryParams } from "./query-params.ts";
import { parseQueryParams } from "./query-params.ts";

const runtime = ManagedRuntime.make(GameDigService.layer);

const respondJson = <T>(body: T, status = 200): Response =>
  Response.json(body, {
    headers: { "cache-control": "no-store" },
    status,
  });

const runQuery = (query: QueryParams): Promise<Response> =>
  runtime.runPromise(
    Effect.gen(function* queryGameServer() {
      const gameDig = yield* GameDigService;
      return yield* gameDig.query(query);
    }).pipe(
      Effect.match({
        onFailure: (error) => {
          const status = error._tag === "GameDigResponseError" ? 502 : 504;
          return respondJson(mapGameDigError(error), status);
        },
        onSuccess: (server) => respondJson({ query, server, success: true }),
      })
    )
  );

export const handleRequest = (
  request: Request
): Response | Promise<Response> => {
  if (request.method !== "GET") {
    return respondJson(
      {
        error: { message: "Use GET", type: "MethodNotAllowed" },
        success: false,
      },
      405
    );
  }

  const url = new URL(request.url);

  switch (url.pathname) {
    case "/health": {
      return respondJson({ service: "cf-gamedig-container", success: true });
    }
    case "/query": {
      const query = parseQueryParams(url.searchParams);
      if (Result.isFailure(query)) {
        return respondJson(
          {
            error: { message: query.failure, type: "InvalidQuery" },
            success: false,
          },
          400
        );
      }
      return runQuery(query.success);
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

export const disposeRuntime = (): Promise<void> => runtime.dispose();
