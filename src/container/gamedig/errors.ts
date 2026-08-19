import type { GameDigQueryError } from "./query-error.ts";
import type { GameDigResponseError } from "./response-error.ts";

/** Payload shared by all GameDig adapter failures. */
export interface GameDigErrorFields {
  readonly type: string;
  readonly host: string;
  readonly port: number;
  readonly message: string;
  readonly elapsedMs: number;
}

/** All expected failures produced by the GameDig adapter. */
export type GameDigError = GameDigQueryError | GameDigResponseError;

/** Public JSON shape returned for an expected application failure. */
export interface ErrorResponseBody {
  readonly success: false;
  readonly stage: "gamedig";
  readonly error: {
    readonly type: string;
    readonly message: string;
  };
  readonly elapsedMs?: number;
  readonly query?: {
    readonly type: string;
    readonly host: string;
    readonly port: number;
  };
}

/** Convert a typed GameDig failure to its safe HTTP representation. */
export const mapGameDigError = (error: GameDigError): ErrorResponseBody => ({
  elapsedMs: error.elapsedMs,
  error: { message: error.message, type: error._tag },
  query: { host: error.host, port: error.port, type: error.type },
  stage: "gamedig",
  success: false,
});
