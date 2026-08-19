import { describe, expect, test } from "bun:test";

import { Effect, Schema } from "effect3";

import {
  A2SProtocolError,
  A2STimeoutError,
} from "../src/container/a2s/errors.ts";
import {
  A2S_INFO_REQUEST,
  parseA2SInfo,
} from "../src/container/a2s/protocol.ts";
import { mapA2SError } from "../src/shared/errors.ts";
import { GameServerStatusSchema } from "../src/shared/schema.ts";

const diagnostics = {
  elapsedMs: 31,
  host: "103.212.227.45",
  port: 27_015,
  startedAt: "2026-08-19T00:00:00.000Z",
} as const;

const fixture = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x11]),
  Buffer.from("KZG Test\0surf_utopia\0csgo\0Counter-Strike 2\0", "utf-8"),
  Buffer.from([0xda, 0x02, 23, 64, 2, 0x64, 0x6c, 0, 1]),
  Buffer.from("1.40.3.1\0", "utf-8"),
]);

describe("A2S protocol", () => {
  test("encodes the canonical A2S_INFO request", () => {
    expect(A2S_INFO_REQUEST.toString("hex")).toBe(
      "ffffffff54536f7572636520456e67696e6520517565727900"
    );
  });

  test("parses the identifying fields from an A2S_INFO response", async () => {
    const result = await Effect.runPromise(parseA2SInfo(fixture, diagnostics));
    expect(result).toEqual({
      appId: 730,
      bots: 2,
      environment: "l",
      folder: "csgo",
      game: "Counter-Strike 2",
      map: "surf_utopia",
      maxPlayers: 64,
      name: "KZG Test",
      players: 23,
      protocol: 17,
      serverType: "d",
      vac: 1,
      version: "1.40.3.1",
      visibility: 0,
    });
  });

  test("returns a typed protocol failure for unrelated UDP data", async () => {
    const error = await Effect.runPromise(
      Effect.flip(parseA2SInfo(Buffer.from("nope"), diagnostics))
    );
    expect(error).toBeInstanceOf(A2SProtocolError);
  });
});

describe("API schemas and errors", () => {
  test("accepts a normalized online GameDig result", () => {
    const decoded = Schema.decodeUnknownSync(GameServerStatusSchema)({
      map: "surf_utopia",
      maxPlayers: 64,
      name: "KZG Test",
      online: true,
      players: 23,
    });
    expect(decoded.online).toBe(true);
  });

  test("rejects an invalid normalized GameDig result", () => {
    expect(() =>
      Schema.decodeUnknownSync(GameServerStatusSchema)({
        map: "surf_utopia",
        maxPlayers: 64,
        name: "KZG Test",
        online: true,
        players: "23",
      })
    ).toThrow();
  });

  test("maps typed Effect failures to stable public JSON", () => {
    const error = new A2STimeoutError({
      diagnostics: { ...diagnostics, elapsedMs: 5000 },
      message: "No UDP response received within 5000 milliseconds",
      timeoutMs: 5000,
    });
    expect(mapA2SError(error)).toEqual({
      diagnostics: { ...diagnostics, elapsedMs: 5000 },
      elapsedMs: 5000,
      error: {
        message: "No UDP response received within 5000 milliseconds",
        type: "A2STimeoutError",
      },
      stage: "receive",
      success: false,
    });
  });
});
