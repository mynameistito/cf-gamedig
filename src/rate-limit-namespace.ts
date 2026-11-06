import { Result } from "effect";

const POSITIVE_INTEGER = /^[1-9]\d*$/u;

/**
 * Parse the account-scoped rate-limit namespace used by the deployment.
 * @param value - Optional configured namespace identifier.
 * @returns The identifier or a configuration error message.
 */
export const parseRateLimitNamespace = (
  value = "31001"
): Result.Result<string, string> =>
  POSITIVE_INTEGER.test(value)
    ? Result.succeed(value)
    : Result.fail(
        "CF_GAMEDIG_RATE_LIMIT_NAMESPACE_ID must be a positive integer"
      );
