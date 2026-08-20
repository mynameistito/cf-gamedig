import { describe, expect, test } from "bun:test";

import type { QueryParams } from "../../src/container/query-params.ts";
import { makeRequestHandler } from "../../src/container/server.ts";
import {
  createRequestId,
  INTERNAL_REQUEST_ID_HEADER,
  makeHttpCompletionMetadata,
  readInternalRequestId,
  REQUEST_ID_HEADER,
} from "../../src/request-correlation.ts";
import { handleWorkerRequest } from "../../src/worker/handler.ts";
import type { WorkerProtection } from "../../src/worker/handler.ts";

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TEST_AUTH_TOKEN = "TEST_AUTH_TOKEN_DO_NOT_FORWARD";
const TEST_CREDENTIAL = "TEST_CREDENTIAL_DO_NOT_LOG";

const ALLOWING_RATE_LIMIT: NonNullable<WorkerProtection["rateLimit"]> = {
  limit: () => Promise.resolve({ success: true }),
};

const openProtection = (): WorkerProtection => ({
  authToken: "",
  rateLimit: ALLOWING_RATE_LIMIT,
});

const forwardedRequestId = (requests: readonly Request[]): string => {
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (request === undefined) {
    throw new Error("Expected a forwarded request");
  }
  const requestId = request.headers.get(INTERNAL_REQUEST_ID_HEADER);
  if (requestId === null) {
    throw new Error("Expected internal request ID");
  }
  return requestId;
};

describe("request correlation", () => {
  test("Worker creates the authoritative ID and replaces caller-supplied IDs", async () => {
    const callerId = "11111111-1111-4111-8111-111111111111";
    const requests: Request[] = [];
    const completions: { readonly requestId?: string }[] = [];

    const response = await handleWorkerRequest(
      new Request("https://api.example.com/health", {
        headers: {
          [INTERNAL_REQUEST_ID_HEADER]: callerId,
          [REQUEST_ID_HEADER]: callerId,
        },
      }),
      (request) => {
        requests.push(request);
        return Response.json({ healthy: true });
      },
      openProtection(),
      (metadata) => completions.push(metadata)
    );

    const requestId = forwardedRequestId(requests);
    expect(requestId).toMatch(REQUEST_ID_PATTERN);
    expect(requestId).not.toBe(callerId);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
    expect(completions).toEqual([expect.objectContaining({ requestId })]);
  });

  test("Worker-generated errors are correlated without forwarding", async () => {
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

  test("Container accepts only valid internal UUIDv4 correlation IDs", () => {
    const valid = createRequestId();
    expect(
      readInternalRequestId(
        new Request("https://container.local/health", {
          headers: { [INTERNAL_REQUEST_ID_HEADER]: valid },
        })
      )
    ).toBe(valid);

    for (const value of [
      "not-a-request-id",
      "11111111-1111-1111-8111-111111111111",
      "x".repeat(4096),
    ]) {
      expect(
        readInternalRequestId(
          new Request("https://container.local/health", {
            headers: { [INTERNAL_REQUEST_ID_HEADER]: value },
          })
        )
      ).toBeUndefined();
    }
  });

  test("Worker and Container propagate one ID across a real Request/Response composition", async () => {
    const observed: Array<{
      readonly query: QueryParams;
      readonly requestId?: string;
    }> = [];
    const containerHandler = makeRequestHandler((query, context) => {
      observed.push(
        context.requestId === undefined
          ? { query }
          : { query, requestId: context.requestId }
      );
      return Response.json({ success: true });
    });
    const forwardedRequests: Request[] = [];

    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com&port=25565",
        { headers: { "cf-connecting-ip": "203.0.113.10" } }
      ),
      (request) => {
        forwardedRequests.push(request);
        return containerHandler(
          new Request(request.url, {
            headers: request.headers,
            method: request.method,
          })
        );
      },
      openProtection()
    );

    const requestId = forwardedRequestId(forwardedRequests);
    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
    expect(observed).toEqual([
      {
        query: expect.objectContaining({
          host: "example.com",
          port: 25_565,
          type: "minecraft",
        }),
        requestId,
      },
    ]);
  });

  test("POST body, credentials, and correlation cross Worker -> Container without Authorization", async () => {
    const observedQueries: QueryParams[] = [];
    const observedForwarding: Array<{
      readonly authorization: string | null;
      readonly method: string;
      readonly requestId: string | null;
    }> = [];
    const containerHandler = makeRequestHandler((query) => {
      observedQueries.push(query);
      return Response.json({ success: true });
    });
    const body = JSON.stringify({
      host: "example.com",
      options: { password: TEST_CREDENTIAL },
      port: 8212,
      type: "palworld",
    });

    const response = await handleWorkerRequest(
      new Request("https://api.example.com/query", {
        body,
        headers: {
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      }),
      async (request) => {
        observedForwarding.push({
          authorization: request.headers.get("authorization"),
          method: request.method,
          requestId: request.headers.get(INTERNAL_REQUEST_ID_HEADER),
        });
        const forwardedBody = await request.arrayBuffer();
        return containerHandler(
          new Request(request.url, {
            body: forwardedBody,
            headers: request.headers,
            method: request.method,
          })
        );
      },
      { authToken: TEST_AUTH_TOKEN, rateLimit: ALLOWING_RATE_LIMIT }
    );

    expect(response.status).toBe(200);
    expect(observedForwarding).toHaveLength(1);
    expect(observedForwarding[0]?.method).toBe("POST");
    expect(observedForwarding[0]?.authorization).toBeNull();
    expect(observedForwarding[0]?.requestId).toMatch(REQUEST_ID_PATTERN);
    expect(observedQueries[0]).toMatchObject({
      host: "example.com",
      password: TEST_CREDENTIAL,
      port: 8212,
      type: "palworld",
    });
  });

  test("safe completion metadata excludes query values, bodies, authorization, and credentials", () => {
    const requestId = createRequestId();
    const request = new Request(
      `https://api.example.com/query?token=${TEST_CREDENTIAL}`,
      {
        body: JSON.stringify({ password: TEST_CREDENTIAL }),
        headers: {
          authorization: `Bearer ${TEST_AUTH_TOKEN}`,
          "content-type": "application/json",
        },
        method: "POST",
      }
    );
    const metadata = makeHttpCompletionMetadata(
      request,
      new Response(null, { status: 504 }),
      12.8,
      requestId
    );
    const serialized = JSON.stringify(metadata);

    expect(metadata).toEqual({
      elapsedMs: 12,
      method: "POST",
      requestId,
      route: "/query",
      status: 504,
    });
    for (const sensitive of [
      TEST_AUTH_TOKEN,
      TEST_CREDENTIAL,
      "authorization",
      "password",
      "token",
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  });
});
