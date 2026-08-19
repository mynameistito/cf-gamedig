import { Clock, Context, Effect, Layer, Schema } from "effect";
import { GameDig } from "gamedig";

import type { QueryParams } from "../query-params.ts";
import { GameDigError } from "./errors.ts";
import type { GameDigResult } from "./schema.ts";
import { GameDigResultSchema } from "./schema.ts";

type GameDigQueryOptions = QueryParams & {
  readonly portCache: false;
};

type RunGameDigQuery = (options: GameDigQueryOptions) => Promise<object>;

interface GameDigServiceDefinition {
  readonly query: (
    query: QueryParams
  ) => Effect.Effect<GameDigResult, GameDigError>;
}

const hasSensitiveOptions = (input: QueryParams): boolean =>
  input.apiKey !== undefined ||
  input.password !== undefined ||
  input.telnetPassword !== undefined ||
  input.token !== undefined;

const toGameDigQueryOptions = (input: QueryParams): GameDigQueryOptions => ({
  ...input,
  debug: hasSensitiveOptions(input) ? false : input.debug,
  portCache: false,
});

const safeFailureCause = (cause: unknown): string =>
  cause instanceof Error ? cause.name : "Unknown GameDig failure";

export class GameDigService extends Context.Service<
  GameDigService,
  GameDigServiceDefinition
>()("@cf-gamedig/GameDigService") {
  static readonly makeLayer = (runGameDigQuery: RunGameDigQuery) =>
    Layer.effect(
      GameDigService,
      Effect.gen(function* makeGameDigService() {
        const clock = yield* Clock.Clock;

        const query = Effect.fn("GameDigService.query")(
          function* queryGameServer(
            input: QueryParams
          ): Effect.fn.Return<GameDigResult, GameDigError> {
            const { givenPortOnly, host, port, type } = input;
            const queryContextWithoutPort = { givenPortOnly, host, type };
            const queryContext =
              port === undefined
                ? queryContextWithoutPort
                : { ...queryContextWithoutPort, port };
            const startedAt = clock.currentTimeMillisUnsafe();

            yield* Effect.logInfo("GameDig query started").pipe(
              Effect.annotateLogs(queryContext)
            );

            const externalResult = yield* Effect.tryPromise({
              catch: (cause) =>
                new GameDigError({
                  cause: safeFailureCause(cause),
                  elapsedMs: clock.currentTimeMillisUnsafe() - startedAt,
                  ...queryContext,
                  kind: "query",
                  message: "GameDig query failed",
                }),
              try: () => runGameDigQuery(toGameDigQueryOptions(input)),
            });

            const result = yield* Schema.decodeUnknownEffect(
              GameDigResultSchema
            )(externalResult).pipe(
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
          }
        );

        return GameDigService.of({ query });
      })
    );

  static readonly layer = GameDigService.makeLayer((options) =>
    GameDig.query(options)
  );
}
