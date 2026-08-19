import { Data } from "effect3";

import type { GameDigErrorFields } from "./error-fields.ts";

/** GameDig rejected or timed out while querying the configured server. */
export class GameDigQueryError extends Data.TaggedError(
  "GameDigQueryError"
)<GameDigErrorFields> {}
