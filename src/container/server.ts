import { Effect, ManagedRuntime, Result } from "effect";

import type { GameDigError } from "./gamedig/errors.ts";
import { mapGameDigError } from "./gamedig/errors.ts";
import { GameDigService } from "./gamedig/service.ts";
import { parseQueryParams } from "./query.ts";
import type { QueryParams } from "./query.ts";

const runtime = ManagedRuntime.make(GameDigService.layer);

const json = <T>(body: T, status = 200): Response =>
  Response.json(body, {
    headers: { "cache-control": "no-store" },
    status,
  });

const gameDigProgram = Effect.fn("GameDigProgram")(function* runGameDig(
  params: QueryParams
) {
  const gameDig = yield* GameDigService;
  return yield* gameDig.query(params.type, params.host, params.port);
});

const runGameDig = (params: QueryParams): Promise<Response> =>
  runtime.runPromise(
    gameDigProgram(params).pipe(
      Effect.match({
        onFailure: (error: GameDigError) => {
          const status = error._tag === "GameDigResponseError" ? 502 : 504;
          return json(mapGameDigError(error), status);
        },
        onSuccess: (server) => json({ query: params, server, success: true }),
      })
    )
  );

/** Handle the Container's small HTTP API without embedding query logic in transport code. */
export const handleRequest = (
  request: Request
): Response | Promise<Response> => {
  if (request.method !== "GET") {
    return json(
      {
        error: { message: "Use GET", type: "MethodNotAllowed" },
        success: false,
      },
      405
    );
  }

  switch (new URL(request.url).pathname) {
    case "/health": {
      return json({ service: "cf-gamedig-container", success: true });
    }
    case "/query": {
      const result = parseQueryParams(new URL(request.url).searchParams);
      if (Result.isFailure(result)) {
        return json(
          {
            error: { message: result.failure, type: "InvalidQuery" },
            success: false,
          },
          400
        );
      }
      return runGameDig(result.success);
    }
    default: {
      return json(
        {
          error: { message: "Route not found", type: "NotFound" },
          success: false,
        },
        404
      );
    }
  }
};

/** Release process-scoped Effect resources during graceful shutdown. */
export const disposeRuntime = (): Promise<void> => runtime.dispose();
