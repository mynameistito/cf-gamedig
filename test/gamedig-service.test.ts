import { describe, expect, test } from "bun:test";

import { Effect, ManagedRuntime } from "effect";
import { games } from "gamedig";

import { GameDigService } from "../src/container/gamedig/service.ts";
import type { QueryParams } from "../src/container/query-params.ts";

interface CapturedGameDigOptions {
  readonly givenPortOnly: boolean;
  readonly host: string;
  readonly port?: number;
  readonly portCache: false;
  readonly type: string;
}

const makeGameDigResult = (queryPort: number) => ({
  bots: [],
  connect: `example.com:${queryPort}`,
  map: "test_map",
  maxplayers: 32,
  name: "Test server",
  numplayers: 1,
  password: false,
  ping: 5,
  players: [],
  queryPort,
  raw: {},
  version: "1.0",
});

const queryWithFake = async (query: QueryParams, queryPort: number) => {
  const calls: Array<CapturedGameDigOptions> = [];
  const runtime = ManagedRuntime.make(
    GameDigService.makeLayer((options) => {
      calls.push(options);
      return Promise.resolve(makeGameDigResult(queryPort));
    })
  );

  try {
    const result = await runtime.runPromise(
      Effect.gen(function* runGameDigQuery() {
        const gameDig = yield* GameDigService;
        return yield* gameDig.query(query);
      })
    );

    return { calls, result };
  } finally {
    await runtime.dispose();
  }
};

describe("GameDigService", () => {
  test("forwards an omitted port without inventing a value", async () => {
    expect(games["ase"]?.options.port_query).toBe(27_015);

    const { calls, result } = await queryWithFake(
      {
        givenPortOnly: false,
        host: "ark.example.com",
        type: "ase",
      },
      27_015
    );

    expect(calls).toEqual([
      {
        givenPortOnly: false,
        host: "ark.example.com",
        portCache: false,
        type: "ase",
      },
    ]);
    expect(Object.hasOwn(calls[0] ?? {}, "port")).toBe(false);
    expect(result.queryPort).toBe(27_015);
  });

  test("preserves supplied ports for GameDig port_query_offset resolution", async () => {
    expect(games["arma3"]?.options.port_query_offset).toBe(1);

    const { calls, result } = await queryWithFake(
      {
        givenPortOnly: false,
        host: "arma.example.com",
        port: 2302,
        type: "arma3",
      },
      2303
    );

    expect(calls).toEqual([
      {
        givenPortOnly: false,
        host: "arma.example.com",
        port: 2302,
        portCache: false,
        type: "arma3",
      },
    ]);
    expect(result.queryPort).toBe(2303);
  });

  test("lets exact-port callers force givenPortOnly=true", async () => {
    const { calls, result } = await queryWithFake(
      {
        givenPortOnly: true,
        host: "cs.example.com",
        port: 27_015,
        type: "counterstrike2",
      },
      27_015
    );

    expect(calls).toEqual([
      {
        givenPortOnly: true,
        host: "cs.example.com",
        port: 27_015,
        portCache: false,
        type: "counterstrike2",
      },
    ]);
    expect(result.queryPort).toBe(27_015);
  });

  test("always disables GameDig port caching", async () => {
    const omittedPort = await queryWithFake(
      {
        givenPortOnly: false,
        host: "ark.example.com",
        type: "ase",
      },
      27_015
    );
    const suppliedPort = await queryWithFake(
      {
        givenPortOnly: true,
        host: "cs.example.com",
        port: 27_015,
        type: "counterstrike2",
      },
      27_015
    );

    expect(omittedPort.calls.map((call) => call.portCache)).toEqual([false]);
    expect(suppliedPort.calls.map((call) => call.portCache)).toEqual([false]);
  });
});
