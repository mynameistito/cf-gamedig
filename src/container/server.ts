import { Effect, ManagedRuntime } from "effect";

import { mapGameDigError } from "../shared/errors.ts";
import type { GameDigError } from "./gamedig/errors.ts";
import { GameDigServiceLive } from "./gamedig/live.ts";
import { GameDigService } from "./gamedig/service.ts";
import { parseQueryParams } from "./query.ts";
import type { QueryParams } from "./query.ts";

const runtime = ManagedRuntime.make(GameDigServiceLive);

const json = <T>(body: T, status = 200): Response =>
  Response.json(body, {
    headers: { "cache-control": "no-store" },
    status,
  });

const gameDigProgram = (params: QueryParams) =>
  Effect.gen(function* runGameDig() {
    const gameDig = yield* GameDigService;
    return yield* gameDig.query(params.type, params.host, params.port);
  });

const runGameDig = async (params: QueryParams): Promise<Response> => {
  const result = await runtime.runPromise(
    gameDigProgram(params).pipe(
      Effect.match({
        onFailure: (error: GameDigError) => json(mapGameDigError(error), 504),
        onSuccess: (server) => json({ query: params, server, success: true }),
      })
    )
  );
  return result;
};

/** Handle the Container's small HTTP API without embedding query logic in transport code. */
export const handleRequest = (request: Request): Promise<Response> => {
  if (request.method !== "GET") {
    return Promise.resolve(
      json(
        {
          error: { message: "Use GET", type: "MethodNotAllowed" },
          success: false,
        },
        405
      )
    );
  }

  switch (new URL(request.url).pathname) {
    case "/health": {
      return Promise.resolve(
        json({ service: "cf-gamedig-container", success: true })
      );
    }
    case "/query": {
      const result = parseQueryParams(new URL(request.url).searchParams);
      if (!result.ok) {
        return Promise.resolve(
          json(
            {
              error: { message: result.message, type: "InvalidQuery" },
              success: false,
            },
            400
          )
        );
      }
      return runGameDig(result.params);
    }
    default: {
      return Promise.resolve(
        json(
          {
            error: { message: "Route not found", type: "NotFound" },
            success: false,
          },
          404
        )
      );
    }
  }
};

/** Release process-scoped Effect resources during graceful shutdown. */
export const disposeRuntime = (): Promise<void> => runtime.dispose();
