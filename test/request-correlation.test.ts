import { describe, expect, test } from "bun:test";

import { makeRequestHandler } from "../src/container/server.ts";
import {
  createRequestId,
  INTERNAL_REQUEST_ID_HEADER,
  makeHttpCompletionMetadata,
  readInternalRequestId,
  REQUEST_ID_HEADER,
} from "../src/request-correlation.ts";
import { handleWorkerRequest } from "../src/worker/handler.ts";
import type { WorkerProtection } from "../src/worker/handler.ts";

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TEST_AUTH_TOKEN = ["TEST", "AUTH", "TOKEN"].join("_");
const TEST_CREDENTIAL = ["TEST", "CREDENTIAL"].join("_");

const ALLOWING_RATE_LIMIT: NonNullable<WorkerProtection["rateLimit"]> = {
  limit: () => Promise.resolve({ success: true }),
};

const openProtection = (): WorkerProtection => ({
  authToken: "",
  rateLimit: ALLOWING_RATE_LIMIT,
});

describe("request correlation", () => {
  test("Worker generates an authoritative request ID and propagates it", async () => {
    const callerId = "11111111-1111-4111-8111-111111111111";
    const forwardedRequests: Request[] = [];
    const completions: Array<{ readonly requestId?: string }> = [];

    const response = await handleWorkerRequest(
      new Request("https://api.example.com/health", {
        headers: {
          [INTERNAL_REQUEST_ID_HEADER]: callerId,
          [REQUEST_ID_HEADER]: callerId,
        },
      }),
      (request) => {
        forwardedRequests.push(request);
        return Response.json({ healthy: true });
      },
      openProtection(),
      (metadata) => completions.push(metadata)
    );

    expect(forwardedRequests).toHaveLength(1);
    const forwardedId = forwardedRequests[0]?.headers.get(
      INTERNAL_REQUEST_ID_HEADER
    );
    expect(forwardedId).toMatch(REQUEST_ID_PATTERN);
    expect(forwardedId).not.toBe(callerId);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(forwardedId);
    expect(completions).toHaveLength(1);
    expect(completions[0]?.requestId).toBe(forwardedId ?? undefined);
  });

  test("oversized caller IDs cannot replace the trusted internal value", async () => {
    const forwardedRequests: Request[] = [];
    const oversizedId = "x".repeat(4096);

    const response = await handleWorkerRequest(
      new Request("https://api.example.com/health", {
        headers: { [INTERNAL_REQUEST_ID_HEADER]: oversizedId },
      }),
      (request) => {
        forwardedRequests.push(request);
        return new Response(null, { status: 204 });
      },
      openProtection()
    );

    const forwardedId = forwardedRequests[0]?.headers.get(
      INTERNAL_REQUEST_ID_HEADER
    );
    expect(forwardedId).toMatch(REQUEST_ID_PATTERN);
    expect(forwardedId).not.toBe(oversizedId);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(forwardedId);
  });

  test("Worker-generated errors carry the request ID", async () => {
    let forwarded = false;

    const response = await handleWorkerRequest(
      new Request("https://api.example.com/private"),
      () => {
        forwarded = true;
        return new Response("unused");
      },
      openProtection()
    );

    expect(forwarded).toBe(false);
    expect(response.status).toBe(404);
    expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(REQUEST_ID_PATTERN);
  });

  test("Container request context and responses retain the same request ID", async () => {
    const requestId = createRequestId();
    const calls: Array<{
      readonly host: string;
      readonly port?: number;
      readonly requestId?: string;
      readonly type: string;
    }> = [];
    const handler = makeRequestHandler((query, context) => {
      calls.push({
        host: query.host,
        ...(query.port === undefined ? {} : { port: query.port }),
        ...(context.requestId === undefined
          ? {}
          : { requestId: context.requestId }),
        type: query.type,
      });
      return Response.json({ success: true });
    });

    const response = await handler(
      new Request(
        "https://container.local/query?type=minecraft&host=example.com&port=25565",
        { headers: { [INTERNAL_REQUEST_ID_HEADER]: requestId } }
      )
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
    expect(calls).toEqual([
      {
        host: "example.com",
        port: 25_565,
        requestId,
        type: "minecraft",
      },
    ]);
  });

  test("downstream errors retain correlation without changing their status", async () => {
    const requestId = createRequestId();
    const handler = makeRequestHandler(() =>
      Response.json(
        {
          error: { message: "GameDig query failed", type: "GameDigQueryError" },
          success: false,
        },
        { status: 504 }
      )
    );

    const response = await handler(
      new Request(
        "https://container.local/query?type=minecraft&host=example.com",
        { headers: { [INTERNAL_REQUEST_ID_HEADER]: requestId } }
      )
    );

    expect(response.status).toBe(504);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
  });

  test("Container rejects malformed internal correlation values", () => {
    const malformed = new Request("https://container.local/health", {
      headers: { [INTERNAL_REQUEST_ID_HEADER]: "not-a-request-id" },
    });

    expect(readInternalRequestId(malformed)).toBeUndefined();
  });

  test("safe HTTP metadata excludes authorization, credentials, query values, and bodies", () => {
    const requestId = createRequestId();
    const request = new Request(
      `https://api.example.com/query?token=${TEST_CREDENTIAL}`,
      {
        body: JSON.stringify({
          apiKey: TEST_CREDENTIAL,
          password: TEST_CREDENTIAL,
          telnetPassword: TEST_CREDENTIAL,
          token: TEST_CREDENTIAL,
        }),
        headers: {
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    );
    const metadata = makeHttpCompletionMetadata(
      request,
      new Response(null, { status: 200 }),
      12.8,
      requestId
    );
    const serialized = JSON.stringify(metadata);

    expect(metadata).toEqual({
      elapsedMs: 12,
      method: "POST",
      requestId,
      route: "/query",
      status: 200,
    });
    expect(serialized).not.toContain(TEST_AUTH_TOKEN);
    expect(serialized).not.toContain(TEST_CREDENTIAL);
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("telnetPassword");
    expect(serialized).not.toContain("token");
  });
});
