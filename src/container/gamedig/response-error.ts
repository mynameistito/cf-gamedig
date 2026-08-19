import { Data } from "effect3";

import type { GameDigErrorFields } from "./error-fields.ts";

/** GameDig returned a response that could not be normalized safely. */
export class GameDigResponseError extends Data.TaggedError(
  "GameDigResponseError"
)<GameDigErrorFields> {}
