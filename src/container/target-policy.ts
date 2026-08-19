import { BlockList, isIP } from "node:net";

import { Result, Schema } from "effect";

import type { QueryParams } from "./query-params.ts";
import { InvalidTargetError } from "./target-policy-error.ts";

export const TARGET_POLICY_ENV = "CF_GAMEDIG_TARGET_POLICY";
export const DEFAULT_TARGET_POLICY_MODE = "open" as const;

export const TargetPolicyModeSchema = Schema.Literals(["open", "public-safe"]);
export type TargetPolicyMode = typeof TargetPolicyModeSchema.Type;

const taggedError = Schema.TaggedError;

class InvalidTargetPolicyConfiguration extends taggedError<InvalidTargetPolicyConfiguration>()(
  "InvalidTargetPolicyConfiguration",
  { message: Schema.String }
) {}

const ipv4 = (...octets: readonly number[]): string => octets.join(".");
const ipv6 = (...parts: readonly string[]): string => parts.join(":");

const ipv4Blocked = new BlockList();
for (const [network, prefix] of [
  [ipv4(0, 0, 0, 0), 8],
  [ipv4(10, 0, 0, 0), 8],
  [ipv4(100, 64, 0, 0), 10],
  [ipv4(127, 0, 0, 0), 8],
  [ipv4(169, 254, 0, 0), 16],
  [ipv4(172, 16, 0, 0), 12],
  [ipv4(192, 0, 0, 0), 24],
  [ipv4(192, 0, 2, 0), 24],
  [ipv4(192, 88, 99, 0), 24],
  [ipv4(192, 168, 0, 0), 16],
  [ipv4(198, 18, 0, 0), 15],
  [ipv4(198, 51, 100, 0), 24],
  [ipv4(203, 0, 113, 0), 24],
  [ipv4(224, 0, 0, 0), 4],
  [ipv4(240, 0, 0, 0), 4],
] as const) {
  ipv4Blocked.addSubnet(network, prefix, "ipv4");
}

const ipv4PublicSpecialCases = new BlockList();
ipv4PublicSpecialCases.addAddress(ipv4(192, 0, 0, 9), "ipv4");
ipv4PublicSpecialCases.addAddress(ipv4(192, 0, 0, 10), "ipv4");

const ipv6GlobalUnicast = new BlockList();
ipv6GlobalUnicast.addSubnet(ipv6("2000", "", ""), 3, "ipv6");

const ipv6Blocked = new BlockList();
for (const [network, prefix] of [
  [ipv6("2001", "", ""), 23],
  [ipv6("2001", "db8", "", ""), 32],
  [ipv6("2002", "", ""), 16],
  [ipv6("3fff", "", ""), 20],
] as const) {
  ipv6Blocked.addSubnet(network, prefix, "ipv6");
}

const NON_CANONICAL_IPV4_LITERAL =
  /^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+)){0,3}\.?$/i;

const invalidTarget = (field: "address" | "host") =>
  new InvalidTargetError({
    message: `Invalid ${field}: public-safe target policy rejects non-public IP literals`,
  });

const isPublicIpLiteral = (value: string): boolean | undefined => {
  const family = isIP(value);
  if (family === 0) {
    if (value.includes("%") || NON_CANONICAL_IPV4_LITERAL.test(value)) {
      return false;
    }
    return undefined;
  }
  if (family === 4) {
    return (
      ipv4PublicSpecialCases.check(value, "ipv4") ||
      !ipv4Blocked.check(value, "ipv4")
    );
  }
  return (
    ipv6GlobalUnicast.check(value, "ipv6") && !ipv6Blocked.check(value, "ipv6")
  );
};

export const parseTargetPolicyMode = (
  value?: string
): Result.Result<TargetPolicyMode, InvalidTargetPolicyConfiguration> =>
  Result.mapError(
    Schema.decodeUnknownResult(TargetPolicyModeSchema)(
      value ?? DEFAULT_TARGET_POLICY_MODE
    ),
    () =>
      new InvalidTargetPolicyConfiguration({
        message: `${TARGET_POLICY_ENV} must be "open" or "public-safe"`,
      })
  );

export const applyTargetPolicy = (
  query: QueryParams,
  mode: TargetPolicyMode
): Result.Result<QueryParams, InvalidTargetError> => {
  if (mode === "open") {
    return Result.succeed(query);
  }

  const hostIsPublic = isPublicIpLiteral(query.host);
  if (hostIsPublic === false) {
    return Result.fail(invalidTarget("host"));
  }

  if (query.address !== undefined) {
    const addressIsPublic = isPublicIpLiteral(query.address);
    if (addressIsPublic === false) {
      return Result.fail(invalidTarget("address"));
    }
  }

  return Result.succeed(query);
};
