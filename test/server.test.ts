import { describe, expect, test } from "bun:test";

import type { QueryParams } from "../src/container/query-params.ts";
import { toPublicQueryParams } from "../src/container/query-params.ts";
import { makeRequestHandler } from "../src/container/server.ts";

const makeFakeHandler = () => {
  const calls: QueryParams[] = [];
  const handler = makeRequestHandler((query) => {
    calls.push(query);
    return Response.json({
      query: toPublicQueryParams(query),
      server: { name: "Fake server" },
      success: true,
    });
  });

  return { calls, handler };
};

const requestQuery = async (query: string) => {
  const { handler } = makeFakeHandler();
  const response = await handler(
    new Request(`https://container.local/query?${query}`)
  );
  const body: unknown = await response.json();

  return { body, response };
};

const postQuery = async (
  body: string,
  contentType: string | undefined = "application/json"
) => {
  const { calls, handler } = makeFakeHandler();
  const request =
    contentType === undefined
      ? new Request("https://container.local/query", {
          body,
          method: "POST",
        })
      : new Request("https://container.local/query", {
          body,
          headers: { "content-type": contentType },
          method: "POST",
        });
  const response = await handler(request);
  const responseBody: unknown = await response.json();

  return { body: responseBody, calls, response };
};

describe("/query validation", () => {
  test("keeps ordinary GET /query compatibility", async () => {
    const { calls, handler } = makeFakeHandler();
    const response = await handler(
      new Request(
        "https://container.local/query?type=minecraft&host=example.com&port=25565&guildId=123456789012345678"
      )
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

  test("returns 400 InvalidQuery for an invalid boolean", async () => {
    const { body, response } = await requestQuery(
      "type=minecraft&host=example.com&debug=1"
    );

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: { type: "InvalidQuery" },
      success: false,
    });
  });

  test("returns 400 InvalidQuery for an invalid number", async () => {
    const { body, response } = await requestQuery(
      "type=minecraft&host=example.com&maxRetries=-1"
    );

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: { type: "InvalidQuery" },
      success: false,
    });
  });

  test("returns 400 InvalidQuery for an invalid enum", async () => {
    const { body, response } = await requestQuery(
      "type=minecraft&host=example.com&ipFamily=5"
    );

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: { type: "InvalidQuery" },
      success: false,
    });
  });

  test("returns 400 InvalidQuery for invalid timeout relationships", async () => {
    const { body, response } = await requestQuery(
      "type=minecraft&host=example.com&socketTimeout=5000&attemptTimeout=5000"
    );

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        message:
          "Invalid timeouts: attemptTimeout must be greater than socketTimeout",
        type: "InvalidQuery",
      },
      success: false,
    });
  });

  test("rejects every sensitive GET option without echoing its value", async () => {
    const fakeSecret = "fake-secret-never-echo";

    for (const option of ["password", "token", "apiKey", "telnetPassword"]) {
      const { body, response } = await requestQuery(
        `type=palworld&host=example.com&${option}=${fakeSecret}`
      );
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(400);
      expect(body).toMatchObject({
        error: { type: "InvalidQuery" },
        success: false,
      });
      expect(serialized).not.toContain(fakeSecret);
      expect(serialized).toContain("POST /query JSON");
    }
  });

  test("accepts POST /query JSON through the same typed query input", async () => {
    const { body, calls, response } = await postQuery(
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
    expect(body).toMatchObject({ success: true });
  });

  test("accepts sensitive POST values without echoing them", async () => {
    const fakePassword = "fake-palworld-password";
    const fakeToken = "fake-api-token";
    const { body, calls, response } = await postQuery(
      JSON.stringify({
        host: "example.com",
        options: {
          apiKey: "fake-api-key",
          password: fakePassword,
          telnetPassword: "fake-telnet-password",
          token: fakeToken,
          username: "admin",
        },
        port: 8212,
        type: "palworld",
      })
    );

    expect(response.status).toBe(200);
    expect(calls[0]).toMatchObject({
      apiKey: "fake-api-key",
      password: fakePassword,
      telnetPassword: "fake-telnet-password",
      token: fakeToken,
      username: "admin",
    });

    const serialized = JSON.stringify(body);
    for (const secret of [
      "fake-api-key",
      fakePassword,
      "fake-telnet-password",
      fakeToken,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("rejects malformed JSON cleanly", async () => {
    const { body, calls, response } = await postQuery("{");

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(body).toEqual({
      error: { message: "Malformed JSON request body", type: "InvalidJson" },
      success: false,
    });
  });

  test("requires application/json for POST /query", async () => {
    for (const contentType of [undefined, "text/plain"]) {
      const { body, calls, response } = await postQuery("{}", contentType);

      expect(response.status).toBe(415);
      expect(calls).toHaveLength(0);
      expect(body).toMatchObject({
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

  test("rejects invalid POST option types before query execution", async () => {
    const fakeSecret = "fake-secret-never-echo";
    const { body, calls, response } = await postQuery(
      JSON.stringify({
        host: "example.com",
        options: { password: fakeSecret, teamspeakQueryPort: "10011" },
        type: "teamspeak3",
      })
    );

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(body).toEqual({
      error: { message: "Invalid POST /query body", type: "InvalidQuery" },
      success: false,
    });
    expect(JSON.stringify(body)).not.toContain(fakeSecret);
  });

  test("parses every required protocol-specific POST combination", async () => {
    const cases = [
      {
        expected: { guildId: "123456789012345678" },
        request: {
          host: "discord.com",
          options: { guildId: "123456789012345678" },
          type: "discord",
        },
      },
      {
        expected: {
          accountId: "fake-account",
          apiKey: "fake-scp-key",
          serverId: "42",
        },
        request: {
          host: "scpsl.example.com",
          options: {
            accountId: "fake-account",
            apiKey: "fake-scp-key",
            serverId: "42",
          },
          type: "scpsl",
        },
      },
      {
        expected: { token: "fake-farming-token" },
        request: {
          host: "farm.example.com",
          options: { token: "fake-farming-token" },
          type: "farmingsimulator22",
        },
      },
      {
        expected: { token: "fake-tshock-token" },
        request: {
          host: "terraria.example.com",
          options: { token: "fake-tshock-token" },
          type: "terraria",
        },
      },
      {
        expected: { password: "fake-pal-password", username: "admin" },
        request: {
          host: "pal.example.com",
          options: { password: "fake-pal-password", username: "admin" },
          type: "palworld",
        },
      },
      {
        expected: {
          moreData: true,
          telnetPassword: "fake-telnet-password",
          telnetPort: 8081,
        },
        request: {
          host: "7dtd.example.com",
          options: {
            moreData: true,
            telnetPassword: "fake-telnet-password",
            telnetPort: 8081,
          },
          type: "7daystodie",
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
        expected: { login: "SuperAdmin", password: "fake-nadeo-password" },
        request: {
          host: "nadeo.example.com",
          options: { login: "SuperAdmin", password: "fake-nadeo-password" },
          type: "trackmania2",
        },
      },
      {
        expected: { rejectUnauthorized: true, token: "fake-satisfactory-token" },
        request: {
          host: "satisfactory.example.com",
          options: {
            rejectUnauthorized: true,
            token: "fake-satisfactory-token",
          },
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
    ];

    for (const entry of cases) {
      const { calls, response } = await postQuery(JSON.stringify(entry.request));

      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject(entry.expected);
    }
  });
});
