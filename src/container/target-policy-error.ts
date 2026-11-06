import { Schema } from "effect";

const taggedError = Schema.TaggedError;

/**
 * Query target rejected by the configured target policy.
 */
export class InvalidTargetError extends taggedError<InvalidTargetError>()(
  "InvalidQuery",
  { message: Schema.String }
) {}
