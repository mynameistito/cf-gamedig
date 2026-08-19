import { Effect, ManagedRuntime } from "effect3";

import { mapA2SError, mapGameDigError } from "../shared/errors.ts";
import type { ErrorResponseBody } from "../shared/errors.ts";
import type { A2SError } from "./a2s/errors.ts";
import { A2SService } from "./a2s/service.ts";
import type { GameDigError } from "./gamedig/errors.ts";
import { GameDigService } from "./gamedig/service.ts";
import { AppConfig, AppLive } from "./layers.ts";
import type { ConfigurationError } from "./layers.ts";
import { parseQueryParams } from "./query.ts";
import type { QueryParams } from "./query.ts";

const runtime = ManagedRuntime.make(AppLive);

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    headers: { "cache-control": "no-store" },
    status,
  });

const configurationErrorBody = (
  error: ConfigurationError
): ErrorResponseBody => ({
  error: { message: error.message, type: error._tag },
  stage: "configuration",
  success: false,
});

const rawA2SProgram = Effect.gen(function* rawA2SProgram() {
  const config = yield* AppConfig;
  const a2s = yield* A2SService;
  return yield* a2s.queryInfo(config.host, config.port, config.a2sTimeoutMs);
});

const gameDigProgram = (params: QueryParams) =>
  Effect.gen(function* runGameDig() {
    const gameDig = yield* GameDigService;
    return yield* gameDig.query(params.type, params.host, params.port);
  });

const runRawA2S = async (): Promise<Response> => {
  const result = await runtime.runPromise(
    rawA2SProgram.pipe(
      Effect.match({
        onFailure: (error: A2SError | ConfigurationError) =>
          json(
            error._tag === "ConfigurationError"
              ? configurationErrorBody(error)
              : mapA2SError(error),
            504
          ),
        onSuccess: (value) => json(value),
      })
    )
  );
  return result;
};

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
        json({ success: true, service: "kzg-gamedig-container" })
      );
    }
    case "/raw-a2s": {
      return runRawA2S();
    }
    case "/query": {
      const result = parseQueryParams(new URL(request.url).searchParams);
      if (!result.ok) {
        return Promise.resolve(
          json(
            {
              success: false,
              error: { message: result.message, type: "InvalidQuery" },
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
            success: false,
            error: { type: "NotFound", message: "Route not found" },
          },
          404
        )
      );
    }
  }
};

/** Release process-scoped Effect resources during graceful shutdown. */
export const disposeRuntime = (): Promise<void> => runtime.dispose();
