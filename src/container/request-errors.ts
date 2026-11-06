import { Schema } from "effect";

const taggedError = Schema.TaggedError;

/**
 * Request body exceeded the configured size limit.
 */
export class PayloadTooLargeError extends taggedError<PayloadTooLargeError>()(
  "PayloadTooLarge",
  { message: Schema.String }
) {}
