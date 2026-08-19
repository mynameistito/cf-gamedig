import { Effect, Layer, Schema } from "effect";
import { GameDig } from "gamedig";

import { GameServerStatusSchema } from "../../shared/schema.ts";
import type { GameServerStatus } from "../../shared/schema.ts";
import { GameDigQueryError, GameDigResponseError } from "./errors.ts";
import type { GameDigError } from "./errors.ts";
import { GameDigService } from "./service.ts";

const query = (
  type: string,
  host: string,
  port: number
): Effect.Effect<GameServerStatus, GameDigError> =>
  Effect.gen(function* runGameDigQuery() {
    const startedAt = Date.now();
    yield* Effect.logInfo("GameDig query started").pipe(
      Effect.annotateLogs({ host, port, type })
    );
    const result = yield* Effect.tryPromise({
      catch: (cause) =>
        new GameDigQueryError({
          elapsedMs: Date.now() - startedAt,
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

    const candidate = {
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
    };

    const status = yield* Schema.decodeUnknownEffect(GameServerStatusSchema)(
      candidate
    ).pipe(
      Effect.mapError(
        () =>
          new GameDigResponseError({
            elapsedMs: Date.now() - startedAt,
            host,
            message: "GameDig returned an invalid server status",
            port,
            type,
          })
      )
    );
    yield* Effect.logInfo("GameDig query completed").pipe(
      Effect.annotateLogs({
        elapsedMs: Date.now() - startedAt,
        host,
        players: status.players,
        port,
        type,
      })
    );
    return status;
  });

/** Live GameDig implementation. */
export const GameDigServiceLive = Layer.succeed(GameDigService, { query });
