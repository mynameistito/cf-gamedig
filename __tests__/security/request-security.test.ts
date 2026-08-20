import { describe, expect, test } from "bun:test";

import { Result, Schema } from "effect";

import type { QueryParams } from "../../src/container/query-params.ts";
import {
  parseQueryParams,
  PostQueryRequestSchema,
} from "../../src/container/query-params.ts";
import {
  MAX_ADDRESS_LENGTH,
  MAX_CREDENTIAL_LENGTH,
  MAX_HOST_LENGTH,
  MAX_POST_BODY_BYTES,
  MAX_POST_BODY_CHUNKS,
  MAX_PROTOCOL_STRING_LENGTH,
  MAX_TYPE_LENGTH,
} from "../../src/container/request-limits.ts";
import { makeRequestHandler } from "../../src/container/server.ts";
import {
  applyTargetPolicy,
  parseTargetPolicyMode,
} from "../../src/container/target-policy.ts";

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

const makeHandler = (targetPolicyMode: "open" | "public-safe" = "open") => {
  const calls: QueryParams[] = [];
  const handler = makeRequestHandler((query) => {
    calls.push(query);
    return Response.json({ success: true });
  }, targetPolicyMode);
  return { calls, handler };
};

const postStream = async (
  stream: ReadableStream<Uint8Array>,
  contentLength?: string
) => {
  const { calls, handler } = makeHandler();
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
  return { body: (await response.json()) as unknown, calls, response };
};

const getQuery = async (
  query: string,
  targetPolicyMode: "open" | "public-safe" = "open"
) => {
  const { calls, handler } = makeHandler(targetPolicyMode);
  const response = await handler(
    new Request(`https://container.local/query?${query}`)
  );
  return { body: (await response.json()) as unknown, calls, response };
};

const ipv4 = (...octets: readonly number[]): string => octets.join(".");
const ipv6 = (...parts: readonly string[]): string => parts.join(":");

describe("request size and field limits", () => {
  test("rejects oversized POST bodies with a stable 413", async () => {
    const { calls, handler } = makeHandler();
    const response = await handler(
      new Request("https://container.local/query", {
        body: " ".repeat(MAX_POST_BODY_BYTES + 1),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    const responseBody: unknown = await response.json();
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toHaveLength(0);
    expect(responseBody).toEqual({
      error: {
        message: `POST /query body exceeds ${MAX_POST_BODY_BYTES} bytes`,
        type: "PayloadTooLarge",
      },
      success: false,
    });
  });

  test("rejects oversized streamed bodies and cancels the reader", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_POST_BODY_BYTES + 1));
      },
    });
    const result = await postStream(stream);
    expect(result.response.status).toBe(413);
    expect(result.calls).toHaveLength(0);
    expect(cancelled).toBe(true);
  });

  test("enforces measured bytes even when Content-Length understates the body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_POST_BODY_BYTES + 1));
        controller.close();
      },
    });
    const result = await postStream(stream, "1");
    expect(result.response.status).toBe(413);
    expect(result.calls).toHaveLength(0);
  });

  test("rejects excessively fragmented request bodies", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index <= MAX_POST_BODY_CHUNKS; index += 1) {
          controller.enqueue(new Uint8Array([120]));
        }
        controller.close();
      },
    });
    const result = await postStream(stream);
    expect(result.response.status).toBe(413);
    expect(result.calls).toHaveLength(0);
    expect(result.body).toEqual({
      error: {
        message: `POST /query body exceeds ${MAX_POST_BODY_CHUNKS} chunks`,
        type: "PayloadTooLarge",
      },
      success: false,
    });
  });

  test("accepts configured field limits and rejects one character beyond them", async () => {
    const getAtLimit = parseQueryParams(
      new URL(
        `https://container.local/query?type=${"t".repeat(MAX_TYPE_LENGTH)}&host=${"h".repeat(MAX_HOST_LENGTH)}&address=${"a".repeat(MAX_ADDRESS_LENGTH)}&username=${"u".repeat(MAX_PROTOCOL_STRING_LENGTH)}`
      ).searchParams
    );
    expect(Result.isSuccess(getAtLimit)).toBe(true);

    const postAtLimit = Schema.decodeUnknownResult(PostQueryRequestSchema)({
      host: "h".repeat(MAX_HOST_LENGTH),
      options: {
        password: "p".repeat(MAX_CREDENTIAL_LENGTH),
        username: "u".repeat(MAX_PROTOCOL_STRING_LENGTH),
      },
      type: "t".repeat(MAX_TYPE_LENGTH),
    });
    expect(Result.isSuccess(postAtLimit)).toBe(true);

    const overLimitQueries = [
      `type=minecraft&host=${"h".repeat(MAX_HOST_LENGTH + 1)}`,
      `type=${"t".repeat(MAX_TYPE_LENGTH + 1)}&host=example.com`,
      `type=minecraft&host=example.com&address=${"a".repeat(MAX_ADDRESS_LENGTH + 1)}`,
      `type=minecraft&host=example.com&username=${"u".repeat(MAX_PROTOCOL_STRING_LENGTH + 1)}`,
    ];
    for (const query of overLimitQueries) {
      const result = await getQuery(query);
      expect(result.response.status).toBe(400);
      expect(result.calls).toHaveLength(0);
    }
  });

  test("oversized credentials fail without reflecting their values", async () => {
    for (const credentialName of [
      "apiKey",
      "password",
      "telnetPassword",
      "token",
    ] as const) {
      const credential = `${credentialName}-${"x".repeat(MAX_CREDENTIAL_LENGTH)}`;
      const { calls, handler } = makeHandler();
      const response = await handler(
        new Request("https://container.local/query", {
          body: JSON.stringify({
            host: "example.com",
            options: { [credentialName]: credential },
            type: "minecraft",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      );
      const serialized = JSON.stringify(await response.json());
      expect(response.status).toBe(400);
      expect(calls).toHaveLength(0);
      expect(serialized).not.toContain(credential);
    }
  });
});

describe("target policy configuration", () => {
  test("defaults to open and accepts only documented modes", () => {
    expect(parseTargetPolicyMode()).toEqual(Result.succeed("open"));
    expect(parseTargetPolicyMode("open")).toEqual(Result.succeed("open"));
    expect(parseTargetPolicyMode("public-safe")).toEqual(
      Result.succeed("public-safe")
    );

    const invalid = parseTargetPolicyMode("private-only");
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure._tag).toBe("InvalidTargetPolicyConfiguration");
      expect(invalid.failure.message).not.toContain("private-only");
    }
  });
});

describe("public-safe target policy", () => {
  test("preserves private-network compatibility in open mode", () => {
    for (const host of [
      ipv4(127, 0, 0, 1),
      ipv4(10, 0, 0, 1),
      ipv6("", "", "1"),
      ipv6("fc00", "", "1"),
    ]) {
      expect(
        Result.isSuccess(applyTargetPolicy({ ...BASE_QUERY, host }, "open"))
      ).toBe(true);
    }
  });

  test("rejects representative non-public IPv4 and IPv6 literals", () => {
    const blocked = [
      ipv4(0, 0, 0, 0),
      ipv4(10, 0, 0, 1),
      ipv4(100, 64, 0, 1),
      ipv4(127, 0, 0, 1),
      ipv4(169, 254, 1, 1),
      ipv4(172, 16, 0, 1),
      ipv4(192, 168, 0, 1),
      ipv4(224, 0, 0, 1),
      ipv4(255, 255, 255, 255),
      ipv6("", "", "1"),
      ipv6("2001", "db8", "", "1"),
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

  test("rejects non-canonical numeric and scoped IP forms for host and address", () => {
    for (const target of [
      "2130706433",
      "0177.0.0.1",
      "0x7f000001",
      "127.1",
      "127.0.0.1.",
      `${ipv6("fe80", "", "1")}%eth0`,
    ]) {
      expect(
        Result.isFailure(
          applyTargetPolicy({ ...BASE_QUERY, host: target }, "public-safe")
        )
      ).toBe(true);
      expect(
        Result.isFailure(
          applyTargetPolicy(
            { ...BASE_QUERY, address: target },
            "public-safe"
          )
        )
      ).toBe(true);
    }
  });

  test("accepts ordinary public literals and hostnames without doing DNS resolution", async () => {
    for (const host of [
      ipv4(1, 1, 1, 1),
      ipv4(8, 8, 8, 8),
      ipv6("2001", "4860", "4860", "", "8888"),
      "internal.example.test",
    ]) {
      expect(
        Result.isSuccess(
          applyTargetPolicy({ ...BASE_QUERY, host }, "public-safe")
        )
      ).toBe(true);
    }

    const routed = await getQuery(
      "type=minecraft&host=internal.example.test",
      "public-safe"
    );
    expect(routed.response.status).toBe(200);
    expect(routed.calls[0]?.host).toBe("internal.example.test");
  });

  test("checks logical host and explicit connection address independently", async () => {
    const blocked = await getQuery(
      "type=minecraft&host=game.example.test&address=127.0.0.1",
      "public-safe"
    );
    expect(blocked.response.status).toBe(400);
    expect(blocked.calls).toHaveLength(0);
    expect(blocked.body).toMatchObject({
      error: { type: "InvalidQuery" },
      success: false,
    });

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
});
