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
  MAX_POST_BODY_CHUNKS,
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

const ipv4 = (...octets: readonly number[]): string => octets.join(".");
const ipv6 = (...parts: readonly string[]): string => parts.join(":");

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

const postStream = async (
  stream: ReadableStream<Uint8Array>,
  contentLength?: string
) => {
  const { calls, handler } = makeFakeHandler();
  const headers = new Headers({ "content-type": "application/json" });
  if (contentLength !== undefined) {
    headers.set("content-length", contentLength);
  }
  const response = await handler(
    new Request("https://container.local/query", {
      body: stream,
      headers,
      method: "POST",
    })
  );
  const responseBody: unknown = await response.json();
  return { body: responseBody, calls, response };
};

const parseGet = (query: string) =>
  parseQueryParams(
    new URL(`https://container.local/query?${query}`).searchParams
  );

describe("request size limits", () => {
  test("rejects oversized POST bodies with a stable 413 response", async () => {
    const oversizedBody = " ".repeat(MAX_POST_BODY_BYTES + 1);
    const { body, calls, response } = await postQuery(oversizedBody);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toHaveLength(0);
    expect(body).toMatchObject({
      error: {
        message: `POST /query body exceeds ${MAX_POST_BODY_BYTES} bytes`,
        type: "PayloadTooLarge",
      },
      success: false,
    });
  });

  test("rejects oversized streamed bodies without content-length and cancels the stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_POST_BODY_BYTES + 1));
      },
    });
    const { calls, response } = await postStream(stream);

    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
    expect(cancelled).toBe(true);
  });

  test("rejects bodies larger than a declared content-length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_POST_BODY_BYTES + 1));
        controller.close();
      },
    });
    const { calls, response } = await postStream(stream, "1");

    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  test("rejects overly fragmented streamed bodies", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index <= MAX_POST_BODY_CHUNKS; index += 1) {
          controller.enqueue(new Uint8Array([120]));
        }
        controller.close();
      },
    });
    const { body, calls, response } = await postStream(stream);

    expect(response.status).toBe(413);
    expect(calls).toHaveLength(0);
    expect(body).toMatchObject({
      error: {
        message: `POST /query body exceeds ${MAX_POST_BODY_CHUNKS} chunks`,
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
    const results = await Promise.all(cases.map((query) => getQuery(query)));

    for (const { body, calls, response } of results) {
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
    const results = await Promise.all(
      credentialNames.map(async (credentialName) => {
        const credential = `credential-${credentialName}-${"x".repeat(MAX_CREDENTIAL_LENGTH)}`;
        const result = await postQuery(
          JSON.stringify({
            host: "example.com",
            options: { [credentialName]: credential },
            type: "minecraft",
          })
        );
        return { ...result, credential };
      })
    );

    for (const { body, calls, credential, response } of results) {
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(calls).toHaveLength(0);
      expect(JSON.stringify(body)).not.toContain(credential);
      expect(body).toMatchObject({
        error: { message: "Invalid POST /query body", type: "InvalidQuery" },
        success: false,
      });
    }
  });

  test("rejects oversized GET credentials before parsing without echoing them", async () => {
    const credential = `credential-${"x".repeat(MAX_CREDENTIAL_LENGTH + 1)}`;
    const { body, calls, response } = await getQuery(
      `type=minecraft&host=example.com&password=${credential}`
    );

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain(credential);
    expect(body).toMatchObject({
      error: { type: "InvalidQuery" },
      success: false,
    });
  });
});

describe("target policy configuration", () => {
  test("defaults to open mode and accepts both documented modes", () => {
    expect(parseTargetPolicyMode()).toEqual(Result.succeed("open"));
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
    const targets = [
      ipv4(127, 0, 0, 1),
      ipv4(10, 0, 0, 1),
      ipv6("", "", "1"),
      ipv6("fc00", "", "1"),
    ];

    for (const host of targets) {
      expect(
        Result.isSuccess(applyTargetPolicy({ ...BASE_QUERY, host }, "open"))
      ).toBe(true);
    }
  });

  test("rejects representative non-public IPv4 literal ranges", () => {
    const blocked = [
      ipv4(0, 0, 0, 0),
      ipv4(10, 0, 0, 1),
      ipv4(100, 64, 0, 1),
      ipv4(127, 0, 0, 1),
      ipv4(169, 254, 1, 1),
      ipv4(172, 16, 0, 1),
      ipv4(192, 0, 2, 1),
      ipv4(192, 168, 0, 1),
      ipv4(198, 18, 0, 1),
      ipv4(198, 51, 100, 1),
      ipv4(203, 0, 113, 1),
      ipv4(224, 0, 0, 1),
      ipv4(240, 0, 0, 1),
      ipv4(255, 255, 255, 255),
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
      ipv6("", "", ""),
      ipv6("", "", "1"),
      ipv6("", "", "ffff", "7f00", "1"),
      ipv6("64", "ff9b", "", "7f00", "1"),
      ipv6("100", "", "1"),
      ipv6("2001", "2", "", "1"),
      ipv6("2001", "db8", "", "1"),
      ipv6("2002", "", "1"),
      ipv6("3fff", "", "1"),
      ipv6("fc00", "", "1"),
      ipv6("fe80", "", "1"),
      ipv6("ff02", "", "1"),
    ];

    for (const host of blocked) {
      expect(
        Result.isFailure(
          applyTargetPolicy({ ...BASE_QUERY, host }, "public-safe")
        )
      ).toBe(true);
    }
  });

  test("rejects non-canonical numeric and scoped IP forms", () => {
    const blocked = [
      "2130706433",
      "0177.0.0.1",
      "0x7f000001",
      "127.1",
      "127.0.0.1.",
      `${ipv6("fe80", "", "1")}%eth0`,
    ];

    for (const target of blocked) {
      expect(
        Result.isFailure(
          applyTargetPolicy({ ...BASE_QUERY, host: target }, "public-safe")
        )
      ).toBe(true);
      expect(
        Result.isFailure(
          applyTargetPolicy({ ...BASE_QUERY, address: target }, "public-safe")
        )
      ).toBe(true);
    }
  });

  test("accepts ordinary public IPv4 and IPv6 literals", () => {
    const publicTargets = [
      ipv4(1, 1, 1, 1),
      ipv4(8, 8, 8, 8),
      ipv6("2001", "4860", "4860", "", "8888"),
      ipv6("2606", "4700", "4700", "", "1111"),
    ];

    for (const host of publicTargets) {
      expect(
        Result.isSuccess(
          applyTargetPolicy({ ...BASE_QUERY, host }, "public-safe")
        )
      ).toBe(true);
    }
  });

  test("checks logical host and connection address independently", async () => {
    const publicAddress = ipv4(8, 8, 8, 8);
    const privateAddress = ipv4(127, 0, 0, 1);
    const blockedAddress = await getQuery(
      `type=minecraft&host=game.example.test&address=${privateAddress}`,
      "public-safe"
    );
    expect(blockedAddress.response.status).toBe(400);
    expect(blockedAddress.calls).toHaveLength(0);
    expect(blockedAddress.body).toMatchObject({
      error: {
        message:
          "Invalid address: public-safe target policy rejects non-public IP literals",
        type: "InvalidQuery",
      },
      success: false,
    });

    const blockedHost = await getQuery(
      `type=minecraft&host=${privateAddress}&address=${publicAddress}`,
      "public-safe"
    );
    expect(blockedHost.response.status).toBe(400);
    expect(blockedHost.calls).toHaveLength(0);

    const allowed = await getQuery(
      `type=minecraft&host=game.example.test&address=${publicAddress}`,
      "public-safe"
    );
    expect(allowed.response.status).toBe(200);
    expect(allowed.calls[0]).toMatchObject({
      address: publicAddress,
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
