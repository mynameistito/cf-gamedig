import { describe, expect, test } from "bun:test";

import { parseQueryParams } from "../src/container/query.ts";

const parse = (search: string) =>
  parseQueryParams(
    new URL(`https://container.local/query${search}`).searchParams
  );

describe("parseQueryParams", () => {
  test("parses a valid query", () => {
    expect(parse("?type=minecraft&host=play.example.com&port=25565")).toEqual({
      ok: true,
      params: {
        host: "play.example.com",
        port: 25_565,
        type: "minecraft",
      },
    });
  });

  test("trims surrounding whitespace from type and host", () => {
    expect(
      parse("?type=%20minecraft%20&host=%20play.example.com%20&port=25565")
    ).toEqual({
      ok: true,
      params: { host: "play.example.com", port: 25_565, type: "minecraft" },
    });
  });

  test("accepts any non-empty game type", () => {
    expect(parse("?type=protocol-valve&host=example.com&port=27015").ok).toBe(
      true
    );
    expect(parse("?type=some-future-game&host=example.com&port=27015").ok).toBe(
      true
    );
  });

  test("rejects a missing type", () => {
    expect(parse("?host=example.com&port=27015")).toEqual({
      message: "Missing required parameter: type",
      ok: false,
    });
  });

  test("rejects an empty type", () => {
    expect(parse("?type=&host=example.com&port=27015")).toEqual({
      message: "Missing required parameter: type",
      ok: false,
    });
  });

  test("rejects a missing host", () => {
    expect(parse("?type=minecraft&port=25565")).toEqual({
      message: "Missing required parameter: host",
      ok: false,
    });
  });

  test("rejects a missing port", () => {
    expect(parse("?type=minecraft&host=example.com")).toEqual({
      message: "Invalid port: expected an integer between 1 and 65535",
      ok: false,
    });
  });

  test("rejects a non-numeric port", () => {
    expect(parse("?type=minecraft&host=example.com&port=abc")).toEqual({
      message: "Invalid port: expected an integer between 1 and 65535",
      ok: false,
    });
  });

  test("rejects a port outside the valid range", () => {
    expect(parse("?type=minecraft&host=example.com&port=65536")).toEqual({
      message: "Invalid port: expected an integer between 1 and 65535",
      ok: false,
    });
  });

  test("rejects a non-integer port", () => {
    expect(parse("?type=minecraft&host=example.com&port=27015.5")).toEqual({
      message: "Invalid port: expected an integer between 1 and 65535",
      ok: false,
    });
  });
});
