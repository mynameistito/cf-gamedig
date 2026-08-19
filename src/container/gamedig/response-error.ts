import { Data } from "effect";

import type { GameDigErrorFields } from "./errors.ts";

/** GameDig returned a response that could not be normalized safely. */
export class GameDigResponseError extends Data.TaggedError(
  "GameDigResponseError"
)<GameDigErrorFields> {}
