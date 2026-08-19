import type { A2SDiagnostics, A2SError } from "../container/a2s/errors.ts";
import type { GameDigError } from "../container/gamedig/errors.ts";

/** Public JSON shape returned for an expected application failure. */
export interface ErrorResponseBody {
  readonly success: false;
  readonly stage:
    | "socket"
    | "bind"
    | "send"
    | "receive"
    | "protocol"
    | "gamedig"
    | "configuration";
  readonly error: {
    readonly type: string;
    readonly message: string;
  };
  readonly diagnostics?: A2SDiagnostics;
  readonly elapsedMs?: number;
}

/** Convert a typed A2S failure to its safe HTTP representation. */
export const mapA2SError = (error: A2SError): ErrorResponseBody => ({
  diagnostics: error.diagnostics,
  elapsedMs: error.diagnostics.elapsedMs,
  error: { message: error.message, type: error._tag },
  stage: error.stage,
  success: false,
});

/** Convert a typed GameDig failure to its safe HTTP representation. */
export const mapGameDigError = (error: GameDigError): ErrorResponseBody => ({
  elapsedMs: error.elapsedMs,
  error: { message: error.message, type: error._tag },
  stage: "gamedig",
  success: false,
});
