import { Schema } from "effect";

const taggedError = Schema.TaggedError;

export class InvalidTargetError extends taggedError<InvalidTargetError>()(
  "InvalidQuery",
  { message: Schema.String }
) {}
