import { Clock, Context, Effect, Layer, Schema } from "effect";
import { GameDig } from "gamedig";

import { GameDigError } from "./errors.ts";
import type { GameDigResult } from "./schema.ts";
import { GameDigResultSchema } from "./schema.ts";

interface GameDigQuery {
  readonly givenPortOnly: boolean;
  readonly host: string;
  readonly port?: number;
  readonly type: string;
}

interface GameDigQueryOptions {
  readonly givenPortOnly: boolean;
  readonly host: string;
  readonly port?: number;
  readonly portCache: false;
  readonly type: string;
}

type RunGameDigQuery = (options: GameDigQueryOptions) => Promise<unknown>;

interface GameDigServiceDefinition {
  readonly query: (
    query: GameDigQuery
  ) => Effect.Effect<GameDigResult, GameDigError>;
}

const toGameDigQueryOptions = (input: GameDigQuery): GameDigQueryOptions => ({
  givenPortOnly: input.givenPortOnly,
  host: input.host,
  ...(input.port === undefined ? {} : { port: input.port }),
  portCache: false,
  type: input.type,
});

const makeGameDigService = (runGameDigQuery: RunGameDigQuery) =>
  Effect.gen(function* makeGameDigServiceEffect() {
    const clock = yield* Clock.Clock;

    const query = Effect.fn("GameDigService.query")(function* queryGameServer(
      input: GameDigQuery
    ): Effect.fn.Return<GameDigResult, GameDigError> {
      const { givenPortOnly, host, port, type } = input;
      const queryContext = {
        givenPortOnly,
        host,
        ...(port === undefined ? {} : { port }),
        type,
      };
      const startedAt = clock.currentTimeMillisUnsafe();

      yield* Effect.logInfo("GameDig query started").pipe(
        Effect.annotateLogs(queryContext)
      );

      const externalResult = yield* Effect.tryPromise({
        catch: (cause) =>
          new GameDigError({
            cause,
            elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
            ...queryContext,
            kind: "query",
            message:
              cause instanceof Error ? cause.message : "GameDig query failed",
          }),
        try: () => runGameDigQuery(toGameDigQueryOptions(input)),
      });

      const result = yield* Schema.decodeUnknownEffect(GameDigResultSchema)(
        externalResult
      ).pipe(
        Effect.mapError(
          (cause) =>
            new GameDigError({
              cause,
              elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
              ...queryContext,
              kind: "response",
              message: "GameDig returned an invalid server result",
            })
        )
      );

      yield* Effect.logInfo("GameDig query completed").pipe(
        Effect.annotateLogs({
          elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
          ...queryContext,
          players: result.numplayers,
          queryPort: result.queryPort,
        })
      );

      return result;
    });

    return GameDigService.of({ query });
  });

export class GameDigService extends Context.Service<
  GameDigService,
  GameDigServiceDefinition
>()("@cf-gamedig/GameDigService") {
  static readonly makeLayer = (runGameDigQuery: RunGameDigQuery) =>
    Layer.effect(GameDigService, makeGameDigService(runGameDigQuery));

  static readonly layer = GameDigService.makeLayer((options) =>
    GameDig.query(options)
  );
}
