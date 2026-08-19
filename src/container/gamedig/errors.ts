import type { GameDigQueryError } from "./query-error.ts";
import type { GameDigResponseError } from "./response-error.ts";

export type { GameDigErrorFields } from "./error-fields.ts";
export { GameDigQueryError } from "./query-error.ts";
export { GameDigResponseError } from "./response-error.ts";

/** All expected failures produced by the GameDig adapter. */
export type GameDigError = GameDigQueryError | GameDigResponseError;
