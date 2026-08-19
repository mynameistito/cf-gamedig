import { describe, expect, test } from "bun:test";

import { parseQueryParams } from "../src/container/query.ts";

const parse = (search: string) =>
  parseQueryParams(
    new URL(`https://container.local/query${search}`).searchParams
  );

describe("parseQueryParams", () => {
  test("parses a valid query", () => {
    expect(
      parse("?type=counterstrike2&host=103.212.227.45&port=27015")
    ).toEqual({
      ok: true,
      params: { host: "103.212.227.45", port: 27_015, type: "counterstrike2" },
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

  test("accepts a protocol-prefixed type", () => {
    expect(parse("?type=protocol-valve&host=example.com&port=27015").ok).toBe(
      true
    );
  });

  test("rejects a missing type", () => {
    expect(parse("?host=example.com&port=27015")).toEqual({
      ok: false,
      message: "Missing required parameter: type",
    });
  });

  test("rejects an unknown game type", () => {
    expect(parse("?type=not-a-game&host=example.com&port=27015")).toEqual({
      ok: false,
      message: "Unknown game type: not-a-game",
    });
  });

  test("rejects a missing host", () => {
    expect(parse("?type=minecraft&port=25565")).toEqual({
      ok: false,
      message: "Missing required parameter: host",
    });
  });

  test("rejects a missing port", () => {
    expect(parse("?type=minecraft&host=example.com")).toEqual({
      ok: false,
      message: "Invalid port: expected an integer between 1 and 65535",
    });
  });

  test("rejects a non-numeric port", () => {
    expect(parse("?type=minecraft&host=example.com&port=abc")).toEqual({
      ok: false,
      message: "Invalid port: expected an integer between 1 and 65535",
    });
  });

  test("rejects a port outside the valid range", () => {
    expect(parse("?type=minecraft&host=example.com&port=65536")).toEqual({
      ok: false,
      message: "Invalid port: expected an integer between 1 and 65535",
    });
  });
});
