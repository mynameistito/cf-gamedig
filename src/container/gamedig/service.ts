import { Clock, Context, Effect, Layer, Schema } from "effect";
import { GameDig } from "gamedig";

import type { GameDigError } from "./errors.ts";
import { GameDigQueryError } from "./query-error.ts";
import { GameDigResponseError } from "./response-error.ts";
import { GameDigResultSchema } from "./schema.ts";
import type { GameDigResult } from "./schema.ts";

/** Full GameDig query capability backed by the GameDig library. */
export class GameDigService extends Context.Service<
  GameDigService,
  {
    readonly query: (
      type: string,
      host: string,
      port: number
    ) => Effect.Effect<GameDigResult, GameDigError>;
  }
>()("@cf-gamedig/GameDigService") {
  /** Live GameDig-backed implementation. */
  static readonly layer = Layer.effect(
    GameDigService,
    Effect.gen(function* makeGameDigService() {
      const clock = yield* Clock.Clock;

      const query = Effect.fn("GameDigService.query")(function* runGameDigQuery(
        type: string,
        host: string,
        port: number
      ): Effect.fn.Return<GameDigResult, GameDigError> {
        const startedAt = clock.currentTimeMillisUnsafe();
        yield* Effect.logInfo("GameDig query started").pipe(
          Effect.annotateLogs({ host, port, type })
        );
        const externalResult = yield* Effect.tryPromise({
          catch: (cause) =>
            new GameDigQueryError({
              elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
              host,
              message:
                cause instanceof Error ? cause.message : "GameDig query failed",
              port,
              type,
            }),
          try: () =>
            GameDig.query({
              givenPortOnly: true,
              host,
              port,
              type,
            }),
        });

        const result = yield* Schema.decodeUnknownEffect(GameDigResultSchema)(
          externalResult
        ).pipe(
          Effect.mapError(
            () =>
              new GameDigResponseError({
                elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
                host,
                message: "GameDig returned an invalid server result",
                port,
                type,
              })
          )
        );
        yield* Effect.logInfo("GameDig query completed").pipe(
          Effect.annotateLogs({
            elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
            host,
            players: result.numplayers,
            port,
            type,
          })
        );
        return result;
      });

      return GameDigService.of({ query });
    })
  );
}
