import { describe, expect, test } from "bun:test";

import { Effect, ManagedRuntime } from "effect";

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
  socketTimeout: 2000,
  stripColors: true,
  type: "minecraft",
};

const makeGameDigResult = () => ({
  bots: [],
  connect: "example.com:27015",
  map: "test_map",
  maxplayers: 32,
  name: "Test server",
  numplayers: 1,
  password: false,
  ping: 5,
  players: [],
  queryPort: 27_015,
  raw: {},
  version: "1.0",
});

const captureQuery = async (query: QueryParams) => {
  const calls: CapturedGameDigOptions[] = [];
  const runtime = ManagedRuntime.make(
    GameDigService.makeLayer((options) => {
      calls.push(options);
      return Promise.resolve(makeGameDigResult());
    })
  );

  try {
    await runtime.runPromise(
      Effect.gen(function* runGameDigQuery() {
        const gameDig = yield* GameDigService;
        return yield* gameDig.query(query);
      })
    );
    return calls;
  } finally {
    await runtime.dispose();
  }
};

describe("protocol-specific GameDig options", () => {
  test("forwards every supported protocol option with its runtime type", async () => {
    const query: QueryParams = {
      ...BASE_QUERY,
      accountId: "TEST_ACCOUNT",
      apiKey: "TEST_KEY",
      guildId: "123456789012345678",
      login: "SuperAdmin",
      moreData: true,
      password: "TEST_PASSWORD",
      rejectUnauthorized: true,
      serverId: "server-42",
      snapshotInterval: "6h",
      teamspeakQueryPort: 10_011,
      telnetPassword: "TEST_TELNET_PASSWORD",
      telnetPort: 8081,
      token: "TEST_TOKEN",
      username: "admin",
    };

    const calls = await captureQuery(query);

    expect(calls).toEqual([
      {
        ...query,
        debug: false,
        portCache: false,
      },
    ]);
  });

  test("disables GameDig debug for credential-bearing calls", async () => {
    const sensitiveOptions: ReadonlyArray<Partial<QueryParams>> = [
      { apiKey: "TEST_KEY" },
      { password: "TEST_PASSWORD" },
      { telnetPassword: "TEST_TELNET_PASSWORD" },
      { token: "TEST_TOKEN" },
    ];

    for (const option of sensitiveOptions) {
      const calls = await captureQuery({ ...BASE_QUERY, ...option, debug: true });
      expect(calls[0]?.debug).toBe(false);
    }
  });

  test("keeps GameDig debug for calls without credentials", async () => {
    const calls = await captureQuery({
      ...BASE_QUERY,
      debug: true,
      guildId: "123456789012345678",
    });

    expect(calls[0]?.debug).toBe(true);
  });
});
