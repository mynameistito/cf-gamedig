import { describe, expect, test } from "bun:test";

import { games } from "gamedig";

import type { QueryParams } from "../../src/container/query-params.ts";
import { makeRequestHandler } from "../../src/container/server.ts";

const TEST_CREDENTIAL = "TEST_CREDENTIAL_DO_NOT_RETURN";

interface ObservedCall {
  readonly query: QueryParams;
  readonly requestId?: string;
}

const makeHandler = () => {
  const calls: ObservedCall[] = [];
  const handler = makeRequestHandler((query, context) => {
    calls.push(
      context.requestId === undefined
        ? { query }
        : { query, requestId: context.requestId }
    );
    return Response.json({ accepted: true, success: true }, { status: 200 });
  });
  return { calls, handler };
};

const readJson = async (response: Response): Promise<unknown> => response.json();

const getQuery = async (query: string) => {
  const { calls, handler } = makeHandler();
  const response = await handler(
    new Request(`https://container.local/query?${query}`)
  );
  return { body: await readJson(response), calls, response };
};

const postQuery = async (
  value: string,
  contentType: string | undefined = "application/json"
) => {
  const { calls, handler } = makeHandler();
  const headers = new Headers();
  if (contentType !== undefined) {
    headers.set("content-type", contentType);
  }
  const response = await handler(
    new Request("https://container.local/query", {
      body: value,
      headers,
      method: "POST",
    })
  );
  return { body: await readJson(response), calls, response };
};

const expectJsonBoundary = (response: Response): void => {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toContain("application/json");
};

describe("container HTTP routes", () => {
  test("GET /health returns the public health contract", async () => {
    const { handler } = makeHandler();
    const response = await handler(new Request("https://container.local/health"));
    expect(response.status).toBe(200);
    expectJsonBoundary(response);
    expect(await readJson(response)).toEqual({
      service: "cf-gamedig-container",
      success: true,
    });
  });

  test("route and method failures expose stable statuses and Allow headers", async () => {
    const { handler } = makeHandler();
    const cases = [
      ["https://container.local/health", "POST", 405, "GET"],
      ["https://container.local/query", "PUT", 405, "GET, POST"],
      ["https://container.local/missing", "GET", 404, null],
      ["https://container.local/missing", "POST", 405, "GET"],
    ] as const;

    for (const [url, method, status, allow] of cases) {
      const response = await handler(new Request(url, { method }));
      expect(response.status).toBe(status);
      expectJsonBoundary(response);
      expect(response.headers.get("allow")).toBe(allow);
      expect(await readJson(response)).toMatchObject({ success: false });
    }
  });
});

describe("GET /query", () => {
  test("parses the real HTTP request and forwards typed generic options", async () => {
    const { calls, response } = await getQuery(
      "type=minecraft&host=example.com&port=25565&maxRetries=2&socketTimeout=3000&attemptTimeout=12000&givenPortOnly=true&ipFamily=4&requestPlayers=false&requestRules=true"
    );
    expect(response.status).toBe(200);
    expectJsonBoundary(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toMatchObject({
      attemptTimeout: 12_000,
      givenPortOnly: true,
      host: "example.com",
      ipFamily: 4,
      maxRetries: 2,
      port: 25_565,
      requestPlayers: false,
      requestRules: true,
      socketTimeout: 3000,
      type: "minecraft",
    });
  });

  test("rejects missing, malformed, and invalid game input before the GameDig boundary", async () => {
    const queries = [
      "host=example.com",
      "type=minecraft",
      "type=minecraft&host=example.com&port=0",
      "type=minecraft&host=example.com&debug=1",
      "type=definitely-not-a-gamedig-id&host=example.com",
    ];

    for (const query of queries) {
      const { body, calls, response } = await getQuery(query);
      expect(response.status).toBe(400);
      expectJsonBoundary(response);
      expect(calls).toHaveLength(0);
      expect(body).toMatchObject({
        error: { type: "InvalidQuery" },
        success: false,
      });
    }
  });

  test("honors legacy GameDig IDs only when checkOldIDs is enabled", async () => {
    const oldId = Object.values(games).find(
      (game) =>
        game.extra?.old_id !== undefined &&
        !Object.hasOwn(games, game.extra.old_id)
    )?.extra?.old_id;
    if (oldId === undefined) {
      throw new Error("Installed GameDig registry has no old-only game ID");
    }

    const disabled = await getQuery(
      `type=${encodeURIComponent(oldId)}&host=example.com`
    );
    expect(disabled.response.status).toBe(400);
    expect(disabled.calls).toHaveLength(0);

    const enabled = await getQuery(
      `type=${encodeURIComponent(oldId)}&host=example.com&checkOldIDs=true`
    );
    expect(enabled.response.status).toBe(200);
    expect(enabled.calls[0]?.query.type).toBe(oldId);
  });

  test("rejects all credential-bearing GET parameters without echoing values", async () => {
    for (const option of ["apiKey", "password", "telnetPassword", "token"]) {
      const { body, calls, response } = await getQuery(
        `type=palworld&host=example.com&${option}=${TEST_CREDENTIAL}`
      );
      const serialized = JSON.stringify(body);
      expect(response.status).toBe(400);
      expect(calls).toHaveLength(0);
      expect(serialized).not.toContain(TEST_CREDENTIAL);
      expect(serialized).toContain("POST /query JSON");
    }
  });

  test("uses first-value precedence for duplicate query parameters", async () => {
    const { calls, response } = await getQuery(
      "type=minecraft&type=quake3&host=first.example.com&host=second.example.com&port=25565&port=27015"
    );
    expect(response.status).toBe(200);
    expect(calls[0]?.query).toMatchObject({
      host: "first.example.com",
      port: 25_565,
      type: "minecraft",
    });
  });
});

describe("POST /query", () => {
  test("accepts typed JSON and forwards sensitive credentials only to the GameDig boundary", async () => {
    const { body, calls, response } = await postQuery(
      JSON.stringify({
        host: "example.com",
        options: {
          apiKey: TEST_CREDENTIAL,
          debug: true,
          password: TEST_CREDENTIAL,
          telnetPassword: TEST_CREDENTIAL,
          token: TEST_CREDENTIAL,
          username: "admin",
        },
        port: 8212,
        type: "palworld",
      })
    );

    expect(response.status).toBe(200);
    expectJsonBoundary(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toMatchObject({
      apiKey: TEST_CREDENTIAL,
      password: TEST_CREDENTIAL,
      telnetPassword: TEST_CREDENTIAL,
      token: TEST_CREDENTIAL,
      username: "admin",
    });
    expect(JSON.stringify(body)).not.toContain(TEST_CREDENTIAL);
  });

  test("covers protocol-specific option combinations used by the runtime protocols", async () => {
    const cases = [
      {
        expected: { guildId: "123456789012345678" },
        request: {
          host: "discord.example.com",
          options: { guildId: "123456789012345678" },
          type: "discord",
        },
      },
      {
        expected: {
          accountId: "TEST_ACCOUNT",
          apiKey: TEST_CREDENTIAL,
          serverId: "42",
        },
        request: {
          host: "scpsl.example.com",
          options: {
            accountId: "TEST_ACCOUNT",
            apiKey: TEST_CREDENTIAL,
            serverId: "42",
          },
          type: "ssl",
        },
      },
      {
        expected: { moreData: true, telnetPassword: TEST_CREDENTIAL, telnetPort: 8081 },
        request: {
          host: "7dtd.example.com",
          options: {
            moreData: true,
            telnetPassword: TEST_CREDENTIAL,
            telnetPort: 8081,
          },
          type: "sdtd",
        },
      },
      {
        expected: { teamspeakQueryPort: 10_011 },
        request: {
          host: "ts.example.com",
          options: { teamspeakQueryPort: 10_011 },
          type: "teamspeak3",
        },
      },
      {
        expected: { rejectUnauthorized: true, token: TEST_CREDENTIAL },
        request: {
          host: "satisfactory.example.com",
          options: { rejectUnauthorized: true, token: TEST_CREDENTIAL },
          type: "satisfactory",
        },
      },
      {
        expected: { serverId: "server-42", snapshotInterval: "6h" },
        request: {
          host: "bp.example.com",
          options: { serverId: "server-42", snapshotInterval: "6h" },
          type: "brokeprotocol",
        },
      },
    ] as const;

    for (const { expected, request } of cases) {
      const { calls, response } = await postQuery(JSON.stringify(request));
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.query).toMatchObject(expected);
    }
  });

  test("rejects malformed JSON, missing bodies, and non-object JSON", async () => {
    const malformed = await postQuery("{");
    expect(malformed.response.status).toBe(400);
    expect(malformed.calls).toHaveLength(0);
    expect(malformed.body).toEqual({
      error: { message: "Malformed JSON request body", type: "InvalidJson" },
      success: false,
    });

    const { calls, handler } = makeHandler();
    const missingBody = await handler(
      new Request("https://container.local/query", {
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    expect(missingBody.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await readJson(missingBody)).toMatchObject({
      error: { type: "InvalidJson" },
      success: false,
    });

    for (const body of ["null", "[]", '"text"']) {
      const result = await postQuery(body);
      expect(result.response.status).toBe(400);
      expect(result.calls).toHaveLength(0);
    }
  });

  test("requires application/json but accepts a charset parameter", async () => {
    for (const contentType of [undefined, "text/plain", "application/problem+json"]) {
      const result = await postQuery("{}", contentType);
      expect(result.response.status).toBe(415);
      expect(result.calls).toHaveLength(0);
      expect(result.body).toMatchObject({
        error: { type: "UnsupportedMediaType" },
        success: false,
      });
    }

    const accepted = await postQuery(
      JSON.stringify({ host: "example.com", type: "minecraft" }),
      "application/json; charset=utf-8"
    );
    expect(accepted.response.status).toBe(200);
  });

  test("rejects wrong JSON types and timeout relationships before the query boundary", async () => {
    const cases = [
      {
        host: "example.com",
        options: { teamspeakQueryPort: "10011" },
        type: "teamspeak3",
      },
      {
        host: "example.com",
        options: { attemptTimeout: 5000, socketTimeout: 5000 },
        type: "minecraft",
      },
    ];

    for (const request of cases) {
      const result = await postQuery(JSON.stringify(request));
      expect(result.response.status).toBe(400);
      expect(result.calls).toHaveLength(0);
      expect(JSON.stringify(result.body)).not.toContain(TEST_CREDENTIAL);
    }
  });

  test("strips unknown top-level and option properties rather than forwarding them", async () => {
    const { calls, response } = await postQuery(
      JSON.stringify({
        host: "example.com",
        ignoredTopLevel: "value",
        options: { ignoredOption: "value", requestPlayers: false },
        type: "minecraft",
      })
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const query = calls[0]?.query;
    expect(Object.hasOwn(query ?? {}, "ignoredTopLevel")).toBe(false);
    expect(Object.hasOwn(query ?? {}, "ignoredOption")).toBe(false);
    expect(query?.requestPlayers).toBe(false);
  });
});
