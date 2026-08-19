import { Schema } from "effect";

const taggedError = Schema.TaggedError;

export class PayloadTooLargeError extends taggedError<PayloadTooLargeError>()(
  "PayloadTooLarge",
  { message: Schema.String }
) {}
