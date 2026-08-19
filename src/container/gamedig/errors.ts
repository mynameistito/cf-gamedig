import { Schema } from "effect";

const gameDigErrorFields = {
  cause: Schema.Unknown,
  elapsedMs: Schema.Number,
  host: Schema.String,
  message: Schema.String,
  port: Schema.Number,
  type: Schema.String,
};

export class GameDigQueryError extends Schema.TaggedError<GameDigQueryError>()(
  "GameDigQueryError",
  gameDigErrorFields
) {}

export class GameDigResponseError extends Schema.TaggedError<GameDigResponseError>()(
  "GameDigResponseError",
  gameDigErrorFields
) {}

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
