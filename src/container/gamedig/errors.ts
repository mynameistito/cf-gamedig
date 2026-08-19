import { Data } from "effect3";

interface GameDigErrorFields {
  readonly host: string;
  readonly port: number;
  readonly message: string;
  readonly elapsedMs: number;
}

/** GameDig rejected or timed out while querying the configured server. */
export class GameDigQueryError extends Data.TaggedError(
  "GameDigQueryError"
)<GameDigErrorFields> {}

/** GameDig returned a response that could not be normalized safely. */
export class GameDigResponseError extends Data.TaggedError(
  "GameDigResponseError"
)<GameDigErrorFields> {}

/** All expected failures produced by the GameDig adapter. */
export type GameDigError = GameDigQueryError | GameDigResponseError;
