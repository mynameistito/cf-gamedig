import { describe, expect, test } from "bun:test";

import { Schema } from "effect";

import type { GameDigResult } from "@/container/gamedig/schema.ts";
import { GameDigResultSchema } from "@/container/gamedig/schema.ts";

const valveRaw = {
  appId: 730,
  environment: "l",
  folder: "csgo",
  game: "Counter-Strike: Global Offensive",
  listentype: "d",
  numbots: 0,
  protocol: 17,
  secure: 1,
  tags: ["empty", "secure"],
};

const minecraftRaw = {
  favicon: "data:image/png;base64,...",
  gamemode: "survival",
  motd: {
    clean: "A Minecraft Server",
    html: "<span>A Minecraft Server</span>",
  },
  plugins: [{ name: "spigot", version: "1.8" }],
};

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

const emptyResult: GameDigResult = {
  bots: [],
  connect: "play.example.com:25565",
  map: "",
  maxplayers: 0,
  name: "",
  numplayers: 0,
  password: false,
  ping: 0,
  players: [],
  queryPort: 0,
  raw: {},
  version: "",
};

describe("GameDig boundary schemas", () => {
  test("accepts a normal generic GameDig result with players and bots", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      bots: [{ name: "bot-1", raw: {} }],
      connect: "play.example.com:27015",
      map: "cp_dustbowl",
      maxplayers: 32,
      name: "cf-gamedig Test",
      numplayers: 12,
      password: true,
      ping: 21,
      players: [
        { name: "alice", raw: { score: 10, time: 120 } },
        { name: "bob", raw: { score: 5, time: 200 } },
      ],
      queryPort: 27_015,
      raw: valveRaw,
    });
    expect(decoded.name).toBe("cf-gamedig Test");
    expect(decoded.password).toBe(true);
    expect(decoded.players).toHaveLength(2);
    expect(decoded.bots).toHaveLength(1);
    expect(decoded.players[0]?.name).toBe("alice");
  });

  test("accepts empty and default values", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)(emptyResult);
    expect(decoded.name).toBe("");
    expect(decoded.map).toBe("");
    expect(decoded.numplayers).toBe(0);
    expect(decoded.maxplayers).toBe(0);
    expect(decoded.players).toEqual([]);
    expect(decoded.bots).toEqual([]);
    expect(decoded.raw).toEqual({});
    expect(decoded.password).toBe(false);
  });

  test("normalizes Teamspeak 3 numeric string player counts", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      maxplayers: "32",
      numplayers: "3",
    });
    expect(decoded.numplayers).toBe(3);
    expect(decoded.maxplayers).toBe(32);
  });

  test("normalizes Quake-style string counts and password values", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      maxplayers: "16",
      numplayers: "4",
      password: "1",
    });
    expect(decoded.numplayers).toBe(4);
    expect(decoded.maxplayers).toBe(16);
    expect(decoded.password).toBe(true);
  });

  test("normalizes epic-style string password values", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      password: "false",
    });
    expect(decoded.password).toBe(false);
  });

  test("mirrors GameDig trueTest semantics for string passwords", () => {
    const decodePassword = (password: string): boolean =>
      Schema.decodeUnknownSync(GameDigResultSchema)({
        ...baseResult,
        password,
      }).password;

    expect(decodePassword("true")).toBe(true);
    expect(decodePassword("TRUE")).toBe(true);
    expect(decodePassword("yes")).toBe(true);
    expect(decodePassword("YeS")).toBe(true);
    expect(decodePassword("1")).toBe(true);
    expect(decodePassword("false")).toBe(false);
    expect(decodePassword("no")).toBe(false);
    expect(decodePassword("0")).toBe(false);
    expect(decodePassword("anything")).toBe(false);
    expect(decodePassword(" true ")).toBe(false);
  });

  test("defaults omitted player and bot raw data", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      bots: [{ name: "bot" }],
      players: [{ name: "x" }],
    });
    expect(decoded.players).toEqual([{ name: "x", raw: {} }]);
    expect(decoded.bots).toEqual([{ name: "bot", raw: {} }]);
  });

  test("accepts Valve-style raw data", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      map: "de_dust2",
      maxplayers: 16,
      name: "Valve Server",
      numplayers: 8,
      ping: 15,
      players: [{ name: "alice", raw: { score: 3, time: 900 } }],
      raw: valveRaw,
      version: "1.38.6",
    });
    expect(decoded.raw.appId).toBe(730);
    expect(decoded.raw.tags).toEqual(["empty", "secure"]);
    expect(decoded.players[0]?.raw).toEqual({ score: 3, time: 900 });
  });

  test("accepts non-Valve-style raw data", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      map: "world",
      name: "Minecraft Server",
      numplayers: 3,
      players: [{ name: "steve", raw: { uuid: "abc-123" } }],
      raw: minecraftRaw,
      version: "1.21",
    });
    expect(decoded.raw.gamemode).toBe("survival");
    expect(decoded.raw.plugins).toEqual([{ name: "spigot", version: "1.8" }]);
  });

  test("accepts arbitrary deeply nested raw data", () => {
    const decoded = Schema.decodeUnknownSync(GameDigResultSchema)({
      ...baseResult,
      raw: {
        list: [1, "two", { three: [true, null, { four: { five: 5 } }] }],
        nested: { deep: { deeper: { value: "x" } } },
      },
    });
    expect(decoded.raw.list).toEqual([
      1,
      "two",
      { three: [true, null, { four: { five: 5 } }] },
    ]);
  });

  test("rejects a result missing required fields", () => {
    expect(() =>
      Schema.decodeUnknownSync(GameDigResultSchema)({ name: "x" })
    ).toThrow();
  });

  test("rejects invalid non-numeric player counts", () => {
    expect(() =>
      Schema.decodeUnknownSync(GameDigResultSchema)({
        ...baseResult,
        numplayers: "twelve",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GameDigResultSchema)({
        ...baseResult,
        maxplayers: "many",
      })
    ).toThrow();
  });

  test("rejects an invalid player name", () => {
    expect(() =>
      Schema.decodeUnknownSync(GameDigResultSchema)({
        ...baseResult,
        players: [{ name: 42, raw: {} }],
      })
    ).toThrow();
  });

  test("rejects a non-object raw value", () => {
    expect(() =>
      Schema.decodeUnknownSync(GameDigResultSchema)({
        ...baseResult,
        raw: "not an object",
      })
    ).toThrow();
  });

  test("rejects a non-object player raw value", () => {
    expect(() =>
      Schema.decodeUnknownSync(GameDigResultSchema)({
        ...baseResult,
        players: [{ name: "alice", raw: ["a", "b"] }],
      })
    ).toThrow();
  });
});
