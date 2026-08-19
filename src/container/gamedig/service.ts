import { Clock, Context, Effect, Layer, Schema } from "effect";
import { GameDig } from "gamedig";

import type { GameDigError } from "./errors.ts";
import { GameDigQueryError, GameDigResponseError } from "./errors.ts";
import type { GameDigResult } from "./schema.ts";
import { GameDigResultSchema } from "./schema.ts";

interface GameDigQuery {
  readonly host: string;
  readonly port: number;
  readonly type: string;
}

interface GameDigServiceShape {
  readonly query: (
    query: GameDigQuery
  ) => Effect.Effect<GameDigResult, GameDigError>;
}

export class GameDigService extends Context.Service<
  GameDigService,
  GameDigServiceShape
>()("@cf-gamedig/GameDigService") {
  static readonly layer = Layer.effect(
    GameDigService,
    Effect.gen(function* makeGameDigService() {
      const clock = yield* Clock.Clock;

      const query = Effect.fn("GameDigService.query")(function* queryGameServer(
        input: GameDigQuery
      ): Effect.fn.Return<GameDigResult, GameDigError> {
        const { host, port, type } = input;
        const startedAt = clock.currentTimeMillisUnsafe();

        yield* Effect.logInfo("GameDig query started").pipe(
          Effect.annotateLogs({ host, port, type })
        );

        const externalResult = yield* Effect.tryPromise({
          catch: (cause) =>
            new GameDigQueryError({
              cause,
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
            (cause) =>
              new GameDigResponseError({
                cause,
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
