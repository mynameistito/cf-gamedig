import { Clock, Context, Effect, Layer, Schema } from "effect";
import { GameDig } from "gamedig";

import type { GameDigError } from "./errors.ts";
import { GameDigQueryError } from "./query-error.ts";
import { GameDigResponseError } from "./response-error.ts";
import { GameDigResultSchema } from "./schema.ts";
import { GameServerStatusSchema } from "./status.ts";
import type { GameServerStatus } from "./status.ts";

/** Normalized GameDig query capability. */
export class GameDigService extends Context.Service<
  GameDigService,
  {
    readonly query: (
      type: string,
      host: string,
      port: number
    ) => Effect.Effect<GameServerStatus, GameDigError>;
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
      ): Effect.fn.Return<GameServerStatus, GameDigError> {
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

        const status = yield* Schema.decodeUnknownEffect(GameDigResultSchema)(
          externalResult
        ).pipe(
          Effect.flatMap((result) =>
            Schema.decodeUnknownEffect(GameServerStatusSchema)({
              bots: result.bots.length,
              connect: result.connect || undefined,
              map: result.map,
              maxPlayers: result.maxplayers,
              name: result.name,
              online: true as const,
              ping: result.ping,
              players: result.numplayers,
              queryPort: result.queryPort || undefined,
              version: result.version || undefined,
            })
          ),
          Effect.mapError(
            () =>
              new GameDigResponseError({
                elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
                host,
                message: "GameDig returned an invalid server status",
                port,
                type,
              })
          )
        );
        yield* Effect.logInfo("GameDig query completed").pipe(
          Effect.annotateLogs({
            elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
            host,
            players: status.players,
            port,
            type,
          })
        );
        return status;
      });

      return GameDigService.of({ query });
    })
  );
}
