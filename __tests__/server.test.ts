import { describe, expect, test } from "bun:test";

import type { QueryParams } from "../src/container/query-params.ts";
import { toPublicQueryParams } from "../src/container/query-params.ts";
import { makeRequestHandler } from "../src/container/server.ts";
import {
  createRequestId,
  INTERNAL_REQUEST_ID_HEADER,
  makeResponseMetadata,
  REQUEST_ID_HEADER,
} from "../src/request-correlation.ts";

const TEST_CREDENTIAL = ["TEST", "CREDENTIAL"].join("_");
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const makeFakeHandler = () => {
  const calls: QueryParams[] = [];
  const handler = makeRequestHandler((query, context) => {
    calls.push(query);
    return Response.json({
      metadata: makeResponseMetadata(context.requestId, context.startedAt),
      query: toPublicQueryParams(query),
      server: { name: "Fake server" },
      success: true,
    });
  });

  return { calls, handler };
};

const requestQuery = async (query: string) => {
  const { calls, handler } = makeFakeHandler();
  const response = await handler(
    new Request(`https://container.local/query?${query}`)
  );
  const body: { readonly metadata?: unknown } = await response.json();
  return { body, calls, response };
};

const postRequest = async (body: string, contentType: string | null) => {
  const { calls, handler } = makeFakeHandler();
  const request =
    contentType === null
      ? new Request("https://container.local/query", { body, method: "POST" })
      : new Request("https://container.local/query", {
          body,
          headers: { "content-type": contentType },
          method: "POST",
        });
  const response = await handler(request);
  const responseBody: unknown = await response.json();
  return { body: responseBody, calls, response };
};

const postQuery = (body: string, contentType = "application/json") =>
  postRequest(body, contentType);

const postWithoutContentType = (body: string) => postRequest(body, null);

describe("/query transport", () => {
  test("keeps ordinary GET compatibility", async () => {
    const { calls, response } = await requestQuery(
      "type=minecraft&host=example.com&port=25565&guildId=123456789012345678"
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      guildId: "123456789012345678",
      host: "example.com",
      port: 25_565,
      type: "minecraft",
    });
  });

  test("keeps existing GET validation", async () => {
    const results = await Promise.all(
      [
        "type=minecraft&host=example.com&debug=1",
        "type=minecraft&host=example.com&maxRetries=-1",
        "type=minecraft&host=example.com&ipFamily=5",
        "type=minecraft&host=example.com&socketTimeout=5000&attemptTimeout=5000",
      ].map(requestQuery)
    );
    for (const result of results) {
      expect(result.response.status).toBe(400);
      expect(result.calls).toHaveLength(0);
      expect(result.body).toMatchObject({
        error: { type: "InvalidQuery" },
        success: false,
      });
    }
  });

  test("rejects sensitive GET parameters without echoing values", async () => {
    const results = await Promise.all(
      ["password", "token", "apiKey", "telnetPassword"].map((option) =>
        requestQuery(
          `type=palworld&host=example.com&${option}=${TEST_CREDENTIAL}`
        )
      )
    );
    for (const result of results) {
      const serialized = JSON.stringify(result.body);
      expect(result.response.status).toBe(400);
      expect(result.calls).toHaveLength(0);
      expect(serialized).not.toContain(TEST_CREDENTIAL);
      expect(serialized).toContain("POST /query JSON");
    }
  });

  test("accepts POST JSON through the typed query pipeline", async () => {
    const { calls, response } = await postQuery(
      JSON.stringify({
        host: "example.com",
        options: { guildId: "123456789012345678" },
        port: 443,
        type: "discord",
      })
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      guildId: "123456789012345678",
      host: "example.com",
      port: 443,
      type: "discord",
    });
  });

  test("accepts sensitive POST values without returning them", async () => {
    const { body, calls, response } = await postQuery(
      JSON.stringify({
        host: "example.com",
        options: {
          apiKey: TEST_CREDENTIAL,
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
    expect(calls[0]).toMatchObject({
      apiKey: TEST_CREDENTIAL,
      password: TEST_CREDENTIAL,
      telnetPassword: TEST_CREDENTIAL,
      token: TEST_CREDENTIAL,
      username: "admin",
    });
    expect(JSON.stringify(body)).not.toContain(TEST_CREDENTIAL);
  });

  test("returns 400 for malformed JSON", async () => {
    const { body, calls, response } = await postQuery("{");
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(body).toMatchObject({
      error: { message: "Malformed JSON request body", type: "InvalidJson" },
      success: false,
    });
  });

  test("requires an application/json content type", async () => {
    const results = await Promise.all([
      postWithoutContentType("{}"),
      postQuery("{}", "text/plain"),
    ]);
    for (const result of results) {
      expect(result.response.status).toBe(415);
      expect(result.calls).toHaveLength(0);
      expect(result.body).toMatchObject({
        error: { type: "UnsupportedMediaType" },
        success: false,
      });
    }
  });

  test("accepts application/json with a charset", async () => {
    const { response } = await postQuery(
      JSON.stringify({ host: "example.com", type: "minecraft" }),
      "application/json; charset=utf-8"
    );
    expect(response.status).toBe(200);
  });

  test("rejects invalid POST types before GameDig", async () => {
    const { body, calls, response } = await postQuery(
      JSON.stringify({
        host: "example.com",
        options: {
          password: TEST_CREDENTIAL,
          teamspeakQueryPort: "10011",
        },
        type: "teamspeak3",
      })
    );
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(body).toMatchObject({
      error: { message: "Invalid POST /query body", type: "InvalidQuery" },
      success: false,
    });
    expect(JSON.stringify(body)).not.toContain(TEST_CREDENTIAL);
  });

  test("parses the required protocol-specific option combinations", async () => {
    const cases = [
      [
        { guildId: "123456789012345678" },
        {
          host: "discord.example.com",
          options: { guildId: "123456789012345678" },
          type: "discord",
        },
      ],
      [
        { accountId: "TEST_ACCOUNT", apiKey: TEST_CREDENTIAL, serverId: "42" },
        {
          host: "scpsl.example.com",
          options: {
            accountId: "TEST_ACCOUNT",
            apiKey: TEST_CREDENTIAL,
            serverId: "42",
          },
          type: "ssl",
        },
      ],
      [
        { token: TEST_CREDENTIAL },
        {
          host: "farm.example.com",
          options: { token: TEST_CREDENTIAL },
          type: "farmingsimulator22",
        },
      ],
      [
        { token: TEST_CREDENTIAL },
        {
          host: "terraria.example.com",
          options: { token: TEST_CREDENTIAL },
          type: "terrariatshock",
        },
      ],
      [
        { password: TEST_CREDENTIAL, username: "admin" },
        {
          host: "pal.example.com",
          options: { password: TEST_CREDENTIAL, username: "admin" },
          type: "palworld",
        },
      ],
      [
        { moreData: true, telnetPassword: TEST_CREDENTIAL, telnetPort: 8081 },
        {
          host: "7dtd.example.com",
          options: {
            moreData: true,
            telnetPassword: TEST_CREDENTIAL,
            telnetPort: 8081,
          },
          type: "sdtd",
        },
      ],
      [
        { teamspeakQueryPort: 10_011 },
        {
          host: "ts.example.com",
          options: { teamspeakQueryPort: 10_011 },
          type: "teamspeak3",
        },
      ],
      [
        { login: "SuperAdmin", password: TEST_CREDENTIAL },
        {
          host: "nadeo.example.com",
          options: { login: "SuperAdmin", password: TEST_CREDENTIAL },
          type: "trackmania2",
        },
      ],
      [
        { rejectUnauthorized: true, token: TEST_CREDENTIAL },
        {
          host: "satisfactory.example.com",
          options: { rejectUnauthorized: true, token: TEST_CREDENTIAL },
          type: "satisfactory",
        },
      ],
      [
        { serverId: "server-42", snapshotInterval: "6h" },
        {
          host: "bp.example.com",
          options: { serverId: "server-42", snapshotInterval: "6h" },
          type: "brokeprotocol",
        },
      ],
    ] as const;
    const results = await Promise.all(
      cases.map(([, request]) => postQuery(JSON.stringify(request)))
    );
    for (const [index, [expected]] of cases.entries()) {
      const result = results[index];
      expect(result?.response.status).toBe(200);
      expect(result?.calls).toHaveLength(1);
      expect(result?.calls[0]).toMatchObject(expected);
    }
  });
});

describe("Container response metadata", () => {
  const validateMetadata = (
    body: { readonly metadata?: unknown },
    requestId: string
  ): void => {
    // SAFETY: the response body is a JSON object and the metadata contract is
    // established by the field-by-field assertions immediately below.
    const metadata = body.metadata as {
      readonly elapsedMs?: unknown;
      readonly requestId?: unknown;
      readonly timestamp?: unknown;
    };
    expect(metadata?.requestId).toBe(requestId);
    expect(metadata?.elapsedMs).toEqual(expect.any(Number));
    expect(Number(metadata?.elapsedMs)).toBeGreaterThanOrEqual(0);
    expect(metadata?.timestamp).toEqual(expect.any(String));
    expect(metadata?.timestamp).toMatch(ISO_TIMESTAMP_PATTERN);
  };

  test("GET /health includes correlated metadata", async () => {
    const response = await makeFakeHandler().handler(
      new Request("https://container.local/health")
    );
    const body: {
      readonly metadata?: unknown;
      readonly service?: string;
      readonly status?: string;
      readonly success?: boolean;
    } = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      service: "cf-gamedig",
      status: "ok",
      success: true,
    });
    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toMatch(REQUEST_ID_PATTERN);
    validateMetadata(body, requestId ?? "");
  });

  test("GET /query success includes correlated metadata", async () => {
    const { body, response } = await requestQuery(
      "type=minecraft&host=example.com&port=25565"
    );
    const requestId = response.headers.get(REQUEST_ID_HEADER);

    expect(response.status).toBe(200);
    expect(requestId).toMatch(REQUEST_ID_PATTERN);
    expect(body).toMatchObject({
      query: expect.objectContaining({
        host: "example.com",
        port: 25_565,
        type: "minecraft",
      }),
      server: { name: "Fake server" },
      success: true,
    });
    validateMetadata(body, requestId ?? "");
  });

  test("generates a local request ID and exposes the same value in body and header", async () => {
    const { body, response } = await requestQuery(
      "type=minecraft&host=example.com"
    );
    const headerRequestId = response.headers.get(REQUEST_ID_HEADER);

    expect(headerRequestId).toMatch(REQUEST_ID_PATTERN);
    validateMetadata(body, headerRequestId ?? "");
  });

  test("reuses a valid internal Worker request ID without generating a second one", async () => {
    const internalRequestId = createRequestId();
    const response = await makeFakeHandler().handler(
      new Request(
        "https://container.local/query?type=minecraft&host=example.com",
        {
          headers: { [INTERNAL_REQUEST_ID_HEADER]: internalRequestId },
        }
      )
    );
    const body: {
      readonly metadata?: { readonly requestId?: unknown };
    } = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(internalRequestId);
    expect(body.metadata?.requestId).toBe(internalRequestId);
  });

  test("error responses include correlated metadata", async () => {
    const { body, response } = await requestQuery(
      "type=minecraft&host=example.com&debug=1"
    );
    const requestId = response.headers.get(REQUEST_ID_HEADER);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: { type: "InvalidQuery" },
      success: false,
    });
    validateMetadata(body, requestId ?? "");
  });
});
