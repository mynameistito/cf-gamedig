import { describe, expect, test } from "bun:test";

import { Effect, Logger, ManagedRuntime, References } from "effect";
import { games } from "gamedig";

import { mapGameDigError } from "../../src/container/gamedig/errors.ts";
import { GameDigService } from "../../src/container/gamedig/service.ts";
import type { QueryParams } from "../../src/container/query-params.ts";

type CapturedGameDigOptions = QueryParams & {
  readonly portCache: false;
};

const TEST_CREDENTIAL = "TEST_CREDENTIAL_DO_NOT_LOG";

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

const makeGameDigResult = (queryPort = 27_015) => ({
  bots: [],
  connect: `example.com:${queryPort}`,
  map: "test_map",
  maxplayers: 32,
  name: "Test server",
  numplayers: 1,
  password: false,
  ping: 5,
  players: [{ name: "Alice", raw: { score: 1 } }],
  queryPort,
  raw: { fixture: true },
  version: "1.0",
});

const captureQuery = async (query: QueryParams, queryPort = 27_015) => {
  const calls: CapturedGameDigOptions[] = [];
  const runtime = ManagedRuntime.make(
    GameDigService.makeLayer((options) => {
      calls.push(options);
      return Promise.resolve(makeGameDigResult(queryPort));
    })
  );

  try {
    const program = Effect.gen(function* runGameDigQuery() {
      const gameDig = yield* GameDigService;
      return yield* gameDig.query(query);
    });
    const server = await runtime.runPromise(
      Effect.provideService(program, References.MinimumLogLevel, "None")
    );
    return { calls, server };
  } finally {
    await runtime.dispose();
  }
};

describe("GameDigService boundary", () => {
  test("forwards supported generic options and enforces internal portCache=false", async () => {
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
      socketTimeout: 5000,
      stripColors: false,
      type: "counterstrike2",
    };

    const { calls } = await captureQuery(query, 27_015);
    expect(calls).toEqual([{ ...query, portCache: false }]);
    expect(Object.hasOwn(calls[0] ?? {}, "listenUdpPort")).toBe(false);
  });

  test("does not invent a port and leaves GameDig to resolve runtime query ports", async () => {
    expect(games.ase?.options.port).toBe(7777);
    expect(games.ase?.options.port_query).toBe(27_015);

    const query: QueryParams = {
      ...BASE_QUERY,
      host: "ark.example.com",
      type: "ase",
    };
    const { calls } = await captureQuery(query);
    expect(calls).toHaveLength(1);
    expect(Object.hasOwn(calls[0] ?? {}, "port")).toBe(false);
  });

  test("preserves supplied ports used by GameDig query-port offsets", async () => {
    expect(games.arma3?.options.port).toBe(2302);
    expect(games.arma3?.options.port_query_offset).toBe(1);

    const query: QueryParams = {
      ...BASE_QUERY,
      host: "arma.example.com",
      port: 2302,
      type: "arma3",
    };
    const { calls } = await captureQuery(query, 2303);
    expect(calls[0]?.port).toBe(2302);
    expect(calls[0]?.givenPortOnly).toBe(false);
  });

  test("forwards every currently exposed protocol-specific option with its typed value", async () => {
    const query: QueryParams = {
      ...BASE_QUERY,
      accountId: "TEST_ACCOUNT",
      apiKey: TEST_CREDENTIAL,
      guildId: "123456789012345678",
      login: "SuperAdmin",
      moreData: true,
      password: TEST_CREDENTIAL,
      rejectUnauthorized: true,
      serverId: "server-42",
      snapshotInterval: "6h",
      teamspeakQueryPort: 10_011,
      telnetPassword: TEST_CREDENTIAL,
      telnetPort: 8081,
      token: TEST_CREDENTIAL,
      username: "admin",
    };

    const { calls } = await captureQuery(query);
    expect(calls).toEqual([
      {
        ...query,
        debug: false,
        portCache: false,
      },
    ]);
  });

  test("disables GameDig debug whenever credentials are present", async () => {
    const options: readonly Partial<QueryParams>[] = [
      { apiKey: TEST_CREDENTIAL },
      { password: TEST_CREDENTIAL },
      { telnetPassword: TEST_CREDENTIAL },
      { token: TEST_CREDENTIAL },
    ];
    const results = await Promise.all(
      options.map((option) =>
        captureQuery({ ...BASE_QUERY, ...option, debug: true })
      )
    );

    for (const { calls } of results) {
      expect(calls[0]?.debug).toBe(false);
    }

    const nonSensitive = await captureQuery({
      ...BASE_QUERY,
      debug: true,
      guildId: "123456789012345678",
    });
    expect(nonSensitive.calls[0]?.debug).toBe(true);
  });

  test("keeps routine Effect logging silent in normal service tests", async () => {
    const runtime = ManagedRuntime.make(
      GameDigService.makeLayer(() => Promise.resolve(makeGameDigResult()))
    );
    try {
      const program = Effect.gen(function* runGameDigQuery() {
        const gameDig = yield* GameDigService;
        return yield* gameDig.query(BASE_QUERY);
      });
      const result = await runtime.runPromise(
        Effect.provideService(program, References.MinimumLogLevel, "None")
      );
      expect(result.name).toBe("Test server");
    } finally {
      await runtime.dispose();
    }
  });

  test("credential-bearing service logs never serialize credential values", async () => {
    const capturedLogs: string[] = [];
    const logger = Logger.make((options) => {
      capturedLogs.push(JSON.stringify(options));
    });
    const runtime = ManagedRuntime.make(
      GameDigService.makeLayer(() => Promise.resolve(makeGameDigResult()))
    );
    const query: QueryParams = {
      ...BASE_QUERY,
      debug: true,
      password: TEST_CREDENTIAL,
      token: TEST_CREDENTIAL,
    };

    try {
      const program = Effect.gen(function* runGameDigQuery() {
        const gameDig = yield* GameDigService;
        return yield* gameDig.query(query);
      }).pipe(
        Effect.withLogger(logger),
        Effect.provideService(References.MinimumLogLevel, "Trace")
      );
      await runtime.runPromise(program);
    } finally {
      await runtime.dispose();
    }

    expect(capturedLogs.length).toBeGreaterThanOrEqual(2);
    const serialized = capturedLogs.join("\n");
    expect(serialized).not.toContain(TEST_CREDENTIAL);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
  });

  test("turns query rejections into typed safe GameDig failures", async () => {
    const runtime = ManagedRuntime.make(
      GameDigService.makeLayer(() =>
        Promise.reject(new Error(`network failed: ${TEST_CREDENTIAL}`))
      )
    );

    try {
      const outcome = await runtime.runPromise(
        Effect.provideService(
          Effect.gen(function* runGameDigQuery() {
            const gameDig = yield* GameDigService;
            return yield* gameDig.query(BASE_QUERY);
          }).pipe(
            Effect.match({
              onFailure: (error) => ({ error, status: "failure" as const }),
              onSuccess: (server) => ({ server, status: "success" as const }),
            })
          ),
          References.MinimumLogLevel,
          "None"
        )
      );

      expect(outcome.status).toBe("failure");
      if (outcome.status === "failure") {
        expect(outcome.error.kind).toBe("query");
        expect(outcome.error.cause).toBe("Error");
        const publicError = mapGameDigError(outcome.error);
        expect(publicError.error.type).toBe("GameDigQueryError");
        expect(JSON.stringify(publicError)).not.toContain(TEST_CREDENTIAL);
      }
    } finally {
      await runtime.dispose();
    }
  });

  test("turns invalid GameDig result shapes into typed response failures", async () => {
    const runtime = ManagedRuntime.make(
      GameDigService.makeLayer(() => Promise.resolve({ name: "incomplete" }))
    );

    try {
      const outcome = await runtime.runPromise(
        Effect.provideService(
          Effect.gen(function* runGameDigQuery() {
            const gameDig = yield* GameDigService;
            return yield* gameDig.query(BASE_QUERY);
          }).pipe(
            Effect.match({
              onFailure: (error) => ({ error, status: "failure" as const }),
              onSuccess: (server) => ({ server, status: "success" as const }),
            })
          ),
          References.MinimumLogLevel,
          "None"
        )
      );

      expect(outcome.status).toBe("failure");
      if (outcome.status === "failure") {
        expect(outcome.error.kind).toBe("response");
        expect(mapGameDigError(outcome.error).error.type).toBe(
          "GameDigResponseError"
        );
      }
    } finally {
      await runtime.dispose();
    }
  });
});
