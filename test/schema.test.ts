import { describe, expect, test } from "bun:test";

import { Schema } from "effect3";

import { GameServerStatusSchema } from "../src/shared/schema.ts";

describe("API schemas", () => {
  test("accepts a normalized online GameDig result", () => {
    const decoded = Schema.decodeUnknownSync(GameServerStatusSchema)({
      map: "surf_utopia",
      maxPlayers: 64,
      name: "cf-gamedig Test",
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
        name: "cf-gamedig Test",
        online: true,
        players: "23",
      })
    ).toThrow();
  });
});
