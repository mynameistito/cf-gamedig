import { describe, expect, test } from "bun:test";

import { Schema } from "effect";

import type { GameDigResult } from "../../src/container/gamedig/schema.ts";
import { GameDigResultSchema } from "../../src/container/gamedig/schema.ts";

const baseResult: GameDigResult = {
  bots: [],
  connect: "play.example.com:25565",
  map: "world",
  maxplayers: 20,
  name: "Example Server",
  numplayers: 0,
  password: false,
  ping: 30,
  players: [],
  queryPort: 25_565,
  raw: {},
  version: "1.0.0",
};

describe("GameDig result schema", () => {
  test("accepts representative player, bot, and protocol raw fields", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      bots: [{ name: "Fixture Bot", raw: { score: 0 } }],
      map: "q3dm17",
      maxplayers: 16,
      name: "CF GameDig E2E",
      numplayers: 2,
      players: [{ name: "Alice", raw: { ping: 42, score: 7 } }],
      queryPort: 27_960,
      raw: {
        clients: "2",
        g_needpass: "0",
        mapname: "q3dm17",
        sv_maxclients: "16",
      },
      version: "ioquake3 1.36",
    });

    expect(decoded).toMatchObject({
      map: "q3dm17",
      maxplayers: 16,
      name: "CF GameDig E2E",
      numplayers: 2,
      queryPort: 27_960,
      version: "ioquake3 1.36",
    });
    expect(decoded.players).toEqual([
      { name: "Alice", raw: { ping: 42, score: 7 } },
    ]);
    expect(decoded.bots).toEqual([
      { name: "Fixture Bot", raw: { score: 0 } },
    ]);
  });

  test("accepts empty lists and legitimately empty metadata", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      connect: "example.com:1",
      map: "",
      maxplayers: 0,
      name: "",
      ping: 0,
      queryPort: 1,
      version: "",
    });
    expect(decoded.players).toEqual([]);
    expect(decoded.bots).toEqual([]);
    expect(decoded.name).toBe("");
    expect(decoded.map).toBe("");
  });

  test("normalizes numeric string player counts returned by protocols", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      maxplayers: "32",
      numplayers: "3",
    });
    expect(decoded.maxplayers).toBe(32);
    expect(decoded.numplayers).toBe(3);
  });

  test("mirrors GameDig trueTest-style string password values", () => {
    const decodePassword = (password: string): boolean =>
      Schema.decodeUnknownSync(GameDigResultSchema)({
        ...baseResult,
        password,
      }).password;

    for (const value of ["true", "TRUE", "yes", "YeS", "1"]) {
      expect(decodePassword(value)).toBe(true);
    }
    for (const value of ["false", "no", "0", "anything", " true "]) {
      expect(decodePassword(value)).toBe(false);
    }
  });

  test("defaults omitted player and bot raw records", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      bots: [{ name: "bot" }],
      players: [{ name: "player" }],
    });
    expect(decoded.players).toEqual([{ name: "player", raw: {} }]);
    expect(decoded.bots).toEqual([{ name: "bot", raw: {} }]);
  });

  test("retains arbitrary nested protocol-specific raw values", () => {
    const raw = {
      list: [1, "two", { three: [true, null] }],
      nested: { deep: { value: "x" } },
    };
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      raw,
    });
    expect(decoded.raw).toEqual(raw);
  });

  test("rejects missing required result fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(GameDigResultSchema)({ name: "x" })
    ).toThrow();
  });

  test("rejects invalid counts, player names, and raw values", () => {
    for (const invalid of [
      { ...baseResult, numplayers: "many" },
      { ...baseResult, maxplayers: "many" },
      { ...baseResult, players: [{ name: 42, raw: {} }] },
      { ...baseResult, raw: "not an object" },
      { ...baseResult, players: [{ name: "alice", raw: ["bad"] }] },
    ]) {
      expect(() => Schema.decodeUnknownSync(GameDigResultSchema)(invalid)).toThrow();
    }
  });
});
