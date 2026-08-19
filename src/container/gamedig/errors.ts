import { Data } from "effect";

interface GameDigErrorFields {
  readonly elapsedMs: number;
  readonly host: string;
  readonly message: string;
  readonly port: number;
  readonly type: string;
}

export class GameDigQueryError extends Data.TaggedError(
  "GameDigQueryError"
)<GameDigErrorFields> {}

export class GameDigResponseError extends Data.TaggedError(
  "GameDigResponseError"
)<GameDigErrorFields> {}

export type GameDigError = GameDigQueryError | GameDigResponseError;

interface GameDigErrorResponse {
  readonly elapsedMs: number;
  readonly error: {
    readonly message: string;
    readonly type: string;
  };
  readonly query: {
    readonly host: string;
    readonly port: number;
    readonly type: string;
  };
  readonly stage: "gamedig";
  readonly success: false;
}

export const mapGameDigError = (error: GameDigError): GameDigErrorResponse => ({
  elapsedMs: error.elapsedMs,
  error: { message: error.message, type: error._tag },
  query: { host: error.host, port: error.port, type: error.type },
  stage: "gamedig",
  success: false,
});
