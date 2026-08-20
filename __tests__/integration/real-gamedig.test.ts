import { describe, expect, test } from "bun:test";

import { Effect, ManagedRuntime, References } from "effect";

import { GameDigService } from "@/container/gamedig/service.ts";
import type { QueryParams } from "@/container/query-params.ts";

import { startQuake3Fixture } from "../fixtures/quake3-server.ts";

const queryFixture = async () => {
  const fixture = await startQuake3Fixture();
  const runtime = ManagedRuntime.make(GameDigService.layer);
  const query: QueryParams = {
    address: fixture.address,
    attemptTimeout: 3000,
    checkOldIDs: false,
    debug: false,
    givenPortOnly: true,
    host: "fixture.invalid",
    ipFamily: 4,
    maxRetries: 1,
    noBreadthOrder: false,
    port: fixture.port,
    requestPlayers: true,
    requestPlayersRequired: false,
    requestRules: false,
    requestRulesRequired: false,
    socketTimeout: 1000,
    stripColors: true,
    type: "protocol-quake3",
  };

  try {
    const program = Effect.gen(function* runGameDigQuery() {
      const gameDig = yield* GameDigService;
      return yield* gameDig.query(query);
    });
    const result = await runtime.runPromise(
      Effect.provideService(program, References.MinimumLogLevel, "None")
    );
    return { exchangeCount: fixture.exchangeCount(), query, result };
  } finally {
    await runtime.dispose();
    fixture.close();
  }
};

describe("real GameDig local integration", () => {
  test("queries the deterministic Quake 3 UDP fixture through the production GameDig service", async () => {
    const { exchangeCount, query, result } = await queryFixture();

    expect(exchangeCount).toBe(1);
    expect(query.givenPortOnly).toBe(true);
    expect(result).toMatchObject({
      connect: `fixture.invalid:${query.port}`,
      map: "q3dm17",
      maxplayers: 16,
      name: "CF GameDig E2E",
      numplayers: 2,
      password: false,
      queryPort: query.port,
      version: "ioquake3 1.36",
    });
    expect(result.ping).toBeGreaterThanOrEqual(0);
    expect(result.players).toHaveLength(1);
    expect(result.players[0]?.name).toBe("Alice");
    expect(result.bots).toHaveLength(1);
    expect(result.bots[0]?.name).toBe("Fixture Bot");
  });

  test("preserves raw values produced by the real Quake 3 parser", async () => {
    const { result } = await queryFixture();

    expect(result.raw).toMatchObject({
      clients: "2",
      g_needpass: "0",
      mapname: "q3dm17",
      sv_maxclients: "16",
    });
    expect(result.players[0]?.raw).toMatchObject({ frags: 7, ping: 42 });
    expect(result.bots[0]?.raw).toMatchObject({ frags: 0, ping: 0 });
  });
});
