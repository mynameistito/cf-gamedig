import { describe, expect, test } from "bun:test";

import { Result } from "effect";
import { games, protocols } from "gamedig";

import { parseGameType } from "../src/container/game-type.ts";
import type { QueryParams } from "../src/container/query-params.ts";
import { makeRequestHandler } from "../src/container/server.ts";

const findOldOnlyId = (): string => {
  const oldOnlyEntry = Object.values(games).find(
    (game) =>
      game.extra?.old_id !== undefined && !Object.hasOwn(games, game.extra.old_id)
  );
  const oldId = oldOnlyEntry?.extra?.old_id;
  if (oldId === undefined) {
    throw new Error("Installed GameDig registry has no old-only game ID");
  }
  return oldId;
};

const makeFakeHandler = () => {
  const calls: QueryParams[] = [];
  const handler = makeRequestHandler((query) => {
    calls.push(query);
    return Response.json({ success: true });
  });
  return { calls, handler };
};

describe("GameDig game type parsing", () => {
  test("accepts a known current ID", () => {
    expect(Result.isSuccess(parseGameType("minecraft", false))).toBe(true);
  });

  test("accepts a supported protocol forcing ID", () => {
    expect(Result.isSuccess(parseGameType("protocol-valve", false))).toBe(true);
  });

  test("rejects an unknown ID", () => {
    const result = parseGameType("definitely-not-a-gamedig-id", false);
    expect(Result.isFailure(result)).toBe(true);
  });

  test("matches installed GameDig registries", () => {
    const currentId = Object.keys(games)[0];
    const protocolId = Object.keys(protocols)[0];
    expect(currentId).toBeDefined();
    expect(protocolId).toBeDefined();
    if (currentId === undefined || protocolId === undefined) {
      throw new Error("Installed GameDig registries are unexpectedly empty");
    }

    expect(Result.isSuccess(parseGameType(currentId, false))).toBe(true);
    expect(
      Result.isSuccess(parseGameType(`protocol-${protocolId}`, false))
    ).toBe(true);
  });

  test("follows checkOldIDs for an old-only ID", () => {
    const oldId = findOldOnlyId();
    expect(Result.isFailure(parseGameType(oldId, false))).toBe(true);
    expect(Result.isSuccess(parseGameType(oldId, true))).toBe(true);
  });

  test("trims surrounding whitespace", () => {
    const result = parseGameType("  minecraft  ", false);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toBe("minecraft");
    }
  });
});

describe("/query game ID validation", () => {
  test("returns 400 without calling GameDig for an unknown ID", async () => {
    const { calls, handler } = makeFakeHandler();
    const response = await handler(
      new Request(
        "https://container.local/query?type=definitely-not-a-gamedig-id&host=example.com"
      )
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(body).toMatchObject({
      error: { type: "InvalidQuery" },
      success: false,
    });
  });

  test("accepts current and protocol IDs without networking in the test seam", async () => {
    const { calls, handler } = makeFakeHandler();
    const currentResponse = await handler(
      new Request(
        "https://container.local/query?type=minecraft&host=example.com"
      )
    );
    const protocolResponse = await handler(
      new Request(
        "https://container.local/query?type=protocol-valve&host=example.com"
      )
    );

    expect(currentResponse.status).toBe(200);
    expect(protocolResponse.status).toBe(200);
    expect(calls.map((query) => query.type)).toEqual([
      "minecraft",
      "protocol-valve",
    ]);
  });

  test("applies checkOldIDs before invoking the query seam", async () => {
    const oldId = findOldOnlyId();
    const disabled = makeFakeHandler();
    const disabledResponse = await disabled.handler(
      new Request(
        `https://container.local/query?type=${encodeURIComponent(oldId)}&host=example.com`
      )
    );
    expect(disabledResponse.status).toBe(400);
    expect(disabled.calls).toHaveLength(0);

    const enabled = makeFakeHandler();
    const enabledResponse = await enabled.handler(
      new Request(
        `https://container.local/query?type=${encodeURIComponent(oldId)}&host=example.com&checkOldIDs=true`
      )
    );
    expect(enabledResponse.status).toBe(200);
    expect(enabled.calls).toHaveLength(1);
    expect(enabled.calls[0]?.type).toBe(oldId);
  });

  test("normalizes a trimmed POST type before the query seam", async () => {
    const { calls, handler } = makeFakeHandler();
    const response = await handler(
      new Request("https://container.local/query", {
        body: JSON.stringify({ host: "example.com", type: "  minecraft  " }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("minecraft");
  });
});
