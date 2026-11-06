import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import { parseRateLimitNamespace } from "@/rate-limit-namespace.ts";

describe("deployment rate-limit namespace", () => {
  test("preserves the existing default and accepts an explicit namespace", () => {
    expect(parseRateLimitNamespace(undefined)).toEqual(Result.succeed("31001"));
    expect(parseRateLimitNamespace("31002")).toEqual(Result.succeed("31002"));
  });

  test("rejects empty, zero, signed and non-integer values", () => {
    for (const value of ["", "0", "-1", "+1", "1.5", "abc"]) {
      expect(Result.isFailure(parseRateLimitNamespace(value))).toBe(true);
    }
  });
});
