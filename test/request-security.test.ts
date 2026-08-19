import { describe, expect, test } from "bun:test";

import { Result, Schema } from "effect";

import type { QueryParams } from "../src/container/query-params.ts";
import {
  parseQueryParams,
  PostQueryRequestSchema,
  toPublicQueryParams,
} from "../src/container/query-params.ts";
import {
  MAX_ADDRESS_LENGTH,
  MAX_CREDENTIAL_LENGTH,
  MAX_HOST_LENGTH,
  MAX_POST_BODY_BYTES,
  MAX_PROTOCOL_STRING_LENGTH,
  MAX_TYPE_LENGTH,
} from "../src/container/request-limits.ts";
import { makeRequestHandler } from "../src/container/server.ts";
import {
  applyTargetPolicy,
  parseTargetPolicyMode,
} from "../src/container/target-policy.ts";

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

const makeFakeHandler = (targetPolicyMode: "open" | "public-safe" = "open") => {
  const calls: QueryParams[] = [];
  const handler = makeRequestHandler((query) => {
    calls.push(query);
    return Response.json({
      query: toPublicQueryParams(query),
      server: { name: "Fake server" },
      success: true,
    });
  }, targetPolicyMode);
  return { calls, handler };
};

const getQuery = async (
  query: string,
  targetPolicyMode: "open" | "public-safe" = "open"
) => {
  const { calls, handler } = makeFakeHandler(targetPolicyMode);
  const response = await handler(
    new Request(`https://container.local/query?${query}`)
  );
  const body: unknown = await response.json();
  return { body, calls, response };
};

const postQuery = async (body: string) => {
  const { calls, handler } = makeFakeHandler();
  const response = await handler(
    new Request("https://container.local/query", {
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  const responseBody: unknown = await response.json();
  return { body: responseBody, calls, response };
};

const parseGet = (query: string) =>
  parseQueryParams(new URL(`https://container.local/query?${query}`).searchParams);

describe("request size limits", () => {
  test("rejects oversized POST bodies with a stable 413 response", async () => {
    const oversizedBody = " ".repeat(MAX_POST_BODY_BYTES + 1);
    const { body, calls, response } = await postQuery(oversizedBody);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toHaveLength(0);
    expect(body).toEqual({
      error: {
        message: `POST /query body exceeds ${MAX_POST_BODY_BYTES} bytes`,
        type: "PayloadTooLarge",
      },
      success: false,
    });
  });

  test("accepts field values at their configured length limits", () => {
    const getRequest = parseGet(
      `type=${"m".repeat(MAX_TYPE_LENGTH)}&host=${"h".repeat(MAX_HOST_LENGTH)}&address=${"a".repeat(MAX_ADDRESS_LENGTH)}&username=${"u".repeat(MAX_PROTOCOL_STRING_LENGTH)}`
    );
    expect(Result.isSuccess(getRequest)).toBe(true);

    const postRequest = Schema.decodeUnknownResult(PostQueryRequestSchema)({
      host: "h".repeat(MAX_HOST_LENGTH),
      options: {
        password: "p".repeat(MAX_CREDENTIAL_LENGTH),
        username: "u".repeat(MAX_PROTOCOL_STRING_LENGTH),
      },
      type: "m".repeat(MAX_TYPE_LENGTH),
    });
    expect(Result.isSuccess(postRequest)).toBe(true);
  });

  test("rejects oversized ordinary fields through InvalidQuery", async () => {
    const cases = [
      `type=minecraft&host=${"h".repeat(MAX_HOST_LENGTH + 1)}`,
      `type=${"m".repeat(MAX_TYPE_LENGTH + 1)}&host=example.com`,
      `type=minecraft&host=example.com&address=${"a".repeat(MAX_ADDRESS_LENGTH + 1)}`,
      `type=minecraft&host=example.com&username=${"u".repeat(MAX_PROTOCOL_STRING_LENGTH + 1)}`,
    ];

    for (const query of cases) {
      const { body, calls, response } = await getQuery(query);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(calls).toHaveLength(0);
      expect(body).toMatchObject({
        error: { type: "InvalidQuery" },
        success: false,
      });
    }
  });

  test("rejects oversized credentials without echoing their values", async () => {
    const credentialNames = [
      "apiKey",
      "password",
      "telnetPassword",
      "token",
    ] as const;

    for (const credentialName of credentialNames) {
      const credential = `credential-${credentialName}-${"x".repeat(MAX_CREDENTIAL_LENGTH)}`;
      const { body, calls, response } = await postQuery(
        JSON.stringify({
          host: "example.com",
          options: { [credentialName]: credential },
          type: "minecraft",
        })
      );
      const serialized = JSON.stringify(body);

      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(calls).toHaveLength(0);
      expect(serialized).not.toContain(credential);
      expect(body).toEqual({
        error: { message: "Invalid POST /query body", type: "InvalidQuery" },
        success: false,
      });
    }
  });
});

describe("target policy configuration", () => {
  test("defaults to open mode and accepts both documented modes", () => {
    expect(parseTargetPolicyMode(undefined)).toEqual(Result.succeed("open"));
    expect(parseTargetPolicyMode("open")).toEqual(Result.succeed("open"));
    expect(parseTargetPolicyMode("public-safe")).toEqual(
      Result.succeed("public-safe")
    );
  });

  test("rejects unknown target policy modes", () => {
    const result = parseTargetPolicyMode("private-only");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("InvalidTargetPolicyConfiguration");
      expect(result.failure.message).not.toContain("private-only");
    }
  });
});

describe("public-safe target policy", () => {
  test("keeps private-network compatibility in open mode", () => {
    for (const target of ["127.0.0.1", "10.0.0.1", "::1", "fc00::1"]) {
      expect(
        Result.isSuccess(
          applyTargetPolicy({ ...BASE_QUERY, host: target }, "open")
        )
      ).toBe(true);
    }
  });

  test("rejects representative non-public IPv4 literal ranges", () => {
    const blocked = [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.0.2.1",
      "192.168.0.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
    ];

    for (const host of blocked) {
      expect(
        Result.isFailure(
          applyTargetPolicy({ ...BASE_QUERY, host }, "public-safe")
        )
      ).toBe(true);
    }
  });

  test("rejects representative non-public IPv6 literal ranges", () => {
    const blocked = [
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "64:ff9b::7f00:1",
      "100::1",
      "2001:2::1",
      "2001:db8::1",
      "2002::1",
      "3fff::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ];

    for (const host of blocked) {
      expect(
        Result.isFailure(
          applyTargetPolicy({ ...BASE_QUERY, host }, "public-safe")
        )
      ).toBe(true);
    }
  });

  test("accepts ordinary public IPv4 and IPv6 literals", () => {
    for (const host of [
      "1.1.1.1",
      "8.8.8.8",
      "2001:4860:4860::8888",
      "2606:4700:4700::1111",
    ]) {
      expect(
        Result.isSuccess(
          applyTargetPolicy({ ...BASE_QUERY, host }, "public-safe")
        )
      ).toBe(true);
    }
  });

  test("checks logical host and connection address independently", async () => {
    const blockedAddress = await getQuery(
      "type=minecraft&host=game.example.test&address=127.0.0.1",
      "public-safe"
    );
    expect(blockedAddress.response.status).toBe(400);
    expect(blockedAddress.calls).toHaveLength(0);
    expect(blockedAddress.body).toEqual({
      error: {
        message:
          "Invalid address: public-safe target policy rejects non-public IP literals",
        type: "InvalidQuery",
      },
      success: false,
    });

    const blockedHost = await getQuery(
      "type=minecraft&host=127.0.0.1&address=8.8.8.8",
      "public-safe"
    );
    expect(blockedHost.response.status).toBe(400);
    expect(blockedHost.calls).toHaveLength(0);

    const allowed = await getQuery(
      "type=minecraft&host=game.example.test&address=8.8.8.8",
      "public-safe"
    );
    expect(allowed.response.status).toBe(200);
    expect(allowed.calls[0]).toMatchObject({
      address: "8.8.8.8",
      host: "game.example.test",
    });
  });

  test("does not perform DNS resolution for hostnames", async () => {
    const { calls, response } = await getQuery(
      "type=minecraft&host=internal.example.test",
      "public-safe"
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.host).toBe("internal.example.test");
  });
});
