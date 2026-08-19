import { describe, expect, test } from "bun:test";

import { Effect, ManagedRuntime } from "effect";
import { games } from "gamedig";

import { GameDigService } from "../src/container/gamedig/service.ts";
import type { QueryParams } from "../src/container/query-params.ts";

type CapturedGameDigOptions = QueryParams & {
  readonly portCache: false;
};

const BASE_QUERY: QueryParams = {
  attemptTimeout: 10_000,
  checkOldIDs: false,
  debug: false,
  givenPortOnly: false,
  host: "play.example.com",
  ipFamily: 0,
  maxRetries: 1,
  noBreadthOrder: false,
  requestPlayers: true,
  requestPlayersRequired: false,
  requestRules: false,
  requestRulesRequired: false,
  socketTimeout: 2_000,
  stripColors: true,
  type: "minecraft",
};

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
  const calls: CapturedGameDigOptions[] = [];
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
  test("forwards every supported generic option unchanged", async () => {
    const query: QueryParams = {
      address: "2001:db8::10",
      attemptTimeout: 15_000,
      checkOldIDs: true,
      debug: true,
      givenPortOnly: true,
      host: "server.example.com",
      ipFamily: 6,
      maxRetries: 2,
      noBreadthOrder: true,
      port: 27_015,
      requestPlayers: false,
      requestPlayersRequired: true,
      requestRules: true,
      requestRulesRequired: true,
      socketTimeout: 5_000,
      stripColors: false,
      type: "counterstrike2",
    };

    const { calls } = await queryWithFake(query, 27_015);

    expect(calls).toEqual([{ ...query, portCache: false }]);
  });

  test("forwards an omitted port without inventing a value", async () => {
    expect(games["ase"]?.options.port_query).toBe(27_015);

    const query: QueryParams = {
      ...BASE_QUERY,
      host: "ark.example.com",
      type: "ase",
    };
    const { calls, result } = await queryWithFake(query, 27_015);

    expect(calls).toEqual([{ ...query, portCache: false }]);
    expect(Object.hasOwn(calls[0] ?? {}, "port")).toBe(false);
    expect(result.queryPort).toBe(27_015);
  });

  test("preserves supplied ports for GameDig port_query_offset resolution", async () => {
    expect(games["arma3"]?.options.port_query_offset).toBe(1);

    const query: QueryParams = {
      ...BASE_QUERY,
      host: "arma.example.com",
      port: 2302,
      type: "arma3",
    };
    const { calls, result } = await queryWithFake(query, 2303);

    expect(calls).toEqual([{ ...query, portCache: false }]);
    expect(result.queryPort).toBe(2303);
  });

  test("lets exact-port callers force givenPortOnly=true", async () => {
    const query: QueryParams = {
      ...BASE_QUERY,
      givenPortOnly: true,
      host: "cs.example.com",
      port: 27_015,
      type: "counterstrike2",
    };
    const { calls, result } = await queryWithFake(query, 27_015);

    expect(calls).toEqual([{ ...query, portCache: false }]);
    expect(result.queryPort).toBe(27_015);
  });

  test("forwards requestRules and requestPlayers independently", async () => {
    const rulesOnly: QueryParams = {
      ...BASE_QUERY,
      requestPlayers: false,
      requestRules: true,
    };
    const playersOnly: QueryParams = {
      ...BASE_QUERY,
      requestPlayers: true,
      requestRules: false,
    };

    const rulesCall = await queryWithFake(rulesOnly, 27_015);
    const playersCall = await queryWithFake(playersOnly, 27_015);

    expect(rulesCall.calls[0]?.requestRules).toBe(true);
    expect(rulesCall.calls[0]?.requestPlayers).toBe(false);
    expect(playersCall.calls[0]?.requestRules).toBe(false);
    expect(playersCall.calls[0]?.requestPlayers).toBe(true);
  });

  test("forwards required Valve query variants", async () => {
    const query: QueryParams = {
      ...BASE_QUERY,
      requestPlayersRequired: true,
      requestRulesRequired: true,
    };

    const { calls } = await queryWithFake(query, 27_015);

    expect(calls[0]?.requestPlayersRequired).toBe(true);
    expect(calls[0]?.requestRulesRequired).toBe(true);
  });

  test("always disables portCache and never forwards listenUdpPort", async () => {
    const { calls } = await queryWithFake(BASE_QUERY, 27_015);
    const call = calls[0];

    expect(call?.portCache).toBe(false);
    expect(Object.hasOwn(call ?? {}, "listenUdpPort")).toBe(false);
  });
});
