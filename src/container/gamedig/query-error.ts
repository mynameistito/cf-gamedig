import { Data } from "effect";

import type { GameDigErrorFields } from "./errors.ts";

/** GameDig rejected or timed out while querying the configured server. */
export class GameDigQueryError extends Data.TaggedError(
  "GameDigQueryError"
)<GameDigErrorFields> {}
