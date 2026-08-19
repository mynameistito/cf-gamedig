import type { GameDigError } from "../container/gamedig/errors.ts";

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
