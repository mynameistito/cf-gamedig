import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import type { QueryParams } from "../src/container/query-params.ts";
import { parseQueryParams } from "../src/container/query-params.ts";

const parse = (search: string) =>
  parseQueryParams(
    new URL(`https://container.local/query${search}`).searchParams
  );

const parseOk = (search: string): QueryParams => {
  const result = parse(search);
  if (Result.isFailure(result)) {
    throw new Error(
      `Expected parse to succeed, got: ${result.failure.message}`
    );
  }
  return result.success;
};

const parseError = (search: string): string => {
  const result = parse(search);
  if (Result.isSuccess(result)) {
    throw new Error("Expected parse to fail");
  }
  expect(result.failure._tag).toBe("InvalidQuery");
  return result.failure.message;
};

describe("parseQueryParams", () => {
  test("parses a valid query", () => {
    expect(parseOk("?type=minecraft&host=play.example.com&port=25565")).toEqual(
      {
        host: "play.example.com",
        port: 25_565,
        type: "minecraft",
      }
    );
  });

  test("trims surrounding whitespace from type and host", () => {
    expect(
      parseOk("?type=%20minecraft%20&host=%20play.example.com%20&port=25565")
    ).toEqual({ host: "play.example.com", port: 25_565, type: "minecraft" });
  });

  test("accepts any non-empty game type", () => {
    expect(
      Result.isSuccess(
        parse("?type=protocol-valve&host=example.com&port=27015")
      )
    ).toBe(true);
    expect(
      Result.isSuccess(
        parse("?type=some-future-game&host=example.com&port=27015")
      )
    ).toBe(true);
  });

  test("rejects a missing type", () => {
    expect(parseError("?host=example.com&port=27015")).toBe(
      "Missing required parameter: type"
    );
  });

  test("rejects an empty type", () => {
    expect(parseError("?type=&host=example.com&port=27015")).toBe(
      "Missing required parameter: type"
    );
  });

  test("rejects a missing host", () => {
    expect(parseError("?type=minecraft&port=25565")).toBe(
      "Missing required parameter: host"
    );
  });

  test("rejects a missing port", () => {
    expect(parseError("?type=minecraft&host=example.com")).toBe(
      "Invalid port: expected an integer between 1 and 65535"
    );
  });

  test("rejects a non-numeric port", () => {
    expect(parseError("?type=minecraft&host=example.com&port=abc")).toBe(
      "Invalid port: expected an integer between 1 and 65535"
    );
  });

  test("rejects a port outside the valid range", () => {
    expect(parseError("?type=minecraft&host=example.com&port=65536")).toBe(
      "Invalid port: expected an integer between 1 and 65535"
    );
  });

  test("rejects a non-integer port", () => {
    expect(parseError("?type=minecraft&host=example.com&port=27015.5")).toBe(
      "Invalid port: expected an integer between 1 and 65535"
    );
  });
});
