import { Schema } from "effect";

const taggedError = Schema.TaggedError;

export class GameDigError extends taggedError<GameDigError>()("GameDigError", {
  cause: Schema.Unknown,
  elapsedMs: Schema.Number,
  host: Schema.String,
  kind: Schema.Literals(["query", "response"]),
  message: Schema.String,
  port: Schema.Number,
  type: Schema.String,
}) {}

interface GameDigErrorResponse {
  readonly elapsedMs: number;
  readonly error: {
    readonly message: string;
    readonly type: "GameDigQueryError" | "GameDigResponseError";
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
  error: {
    message: error.message,
    type:
      error.kind === "response" ? "GameDigResponseError" : "GameDigQueryError",
  },
  query: { host: error.host, port: error.port, type: error.type },
  stage: "gamedig",
  success: false,
});
