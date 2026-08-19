import { Schema } from "effect";

const taggedError = Schema.TaggedError;

export class GameDigError extends taggedError<GameDigError>()("GameDigError", {
  cause: Schema.Unknown,
  elapsedMs: Schema.Number,
  givenPortOnly: Schema.Boolean,
  host: Schema.String,
  kind: Schema.Literals(["query", "response"]),
  message: Schema.String,
  port: Schema.optionalKey(Schema.Number),
  type: Schema.String,
}) {}

interface GameDigErrorResponse {
  readonly elapsedMs: number;
  readonly error: {
    readonly message: string;
    readonly type: "GameDigQueryError" | "GameDigResponseError";
  };
  readonly query: {
    readonly givenPortOnly: boolean;
    readonly host: string;
    readonly port?: number;
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
  query: {
    givenPortOnly: error.givenPortOnly,
    host: error.host,
    ...(error.port === undefined ? {} : { port: error.port }),
    type: error.type,
  },
  stage: "gamedig",
  success: false,
});
