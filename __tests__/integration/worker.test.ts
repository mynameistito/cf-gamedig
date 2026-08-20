import { describe, expect, test } from "bun:test";

import {
  INTERNAL_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
} from "../../src/request-correlation.ts";
import { handleWorkerRequest } from "../../src/worker/handler.ts";
import type { WorkerProtection } from "../../src/worker/handler.ts";

const TEST_CREDENTIAL = "TEST_CREDENTIAL_DO_NOT_LEAK";
const TEST_AUTH_TOKEN = "TEST_AUTH_TOKEN_DO_NOT_LEAK";
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const ALLOWING_RATE_LIMIT: NonNullable<WorkerProtection["rateLimit"]> = {
  limit: () => Promise.resolve({ success: true }),
};

const openProtection = (): WorkerProtection => ({
  authToken: "",
  rateLimit: ALLOWING_RATE_LIMIT,
});

const protectedWorker = (authToken = TEST_AUTH_TOKEN): WorkerProtection => ({
  authToken,
  rateLimit: ALLOWING_RATE_LIMIT,
});

const makeRateLimit = (success: boolean) => {
  const keys: string[] = [];
  const rateLimit: NonNullable<WorkerProtection["rateLimit"]> = {
    limit: ({ key }) => {
      keys.push(key);
      return Promise.resolve({ success });
    },
  };
  return { keys, rateLimit };
};

const makeForwarder = (response: Response) => {
  const requests: Request[] = [];
  return {
    forwardRequest: (request: Request): Response => {
      requests.push(request);
      return response;
    },
    requests,
  };
};

const onlyRequest = (requests: readonly Request[]): Request => {
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (request === undefined) {
    throw new Error("Expected one forwarded request");
  }
  return request;
};

describe("Worker forwarding boundary", () => {
  test("preserves method, path, query string, body, content type, and ordinary headers", async () => {
    const getForwarder = makeForwarder(Response.json({ success: true }));
    const getRequest = new Request(
      "https://api.example.com/query?type=minecraft&host=example.com&port=25565",
      { headers: { "x-client-header": "preserve-me" } }
    );
    await handleWorkerRequest(
      getRequest,
      getForwarder.forwardRequest,
      openProtection()
    );
    const forwardedGet = onlyRequest(getForwarder.requests);
    expect(forwardedGet.method).toBe("GET");
    expect(forwardedGet.url).toBe(getRequest.url);
    expect(forwardedGet.headers.get("x-client-header")).toBe("preserve-me");
    expect(forwardedGet.headers.get(INTERNAL_REQUEST_ID_HEADER)).toMatch(
      REQUEST_ID_PATTERN
    );

    const postForwarder = makeForwarder(Response.json({ success: true }));
    const body = JSON.stringify({
      host: "example.com",
      options: { password: TEST_CREDENTIAL },
      type: "palworld",
    });
    await handleWorkerRequest(
      new Request("https://api.example.com/query", {
        body,
        headers: { "content-type": "application/json; charset=utf-8" },
        method: "POST",
      }),
      postForwarder.forwardRequest,
      openProtection()
    );
    const forwardedPost = onlyRequest(postForwarder.requests);
    expect(forwardedPost.method).toBe("POST");
    expect(forwardedPost.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    expect(await forwardedPost.text()).toBe(body);
  });

  test("forwards public GET /health without applying query rate limits", async () => {
    const responseFromContainer = Response.json({ healthy: true });
    const forwarder = makeForwarder(responseFromContainer);
    const response = await handleWorkerRequest(
      new Request("https://api.example.com/health"),
      forwarder.forwardRequest,
      { authToken: TEST_AUTH_TOKEN }
    );

    expect(response).toBe(responseFromContainer);
    expect(forwarder.requests).toHaveLength(1);
  });

  test("rejects unsupported routes and methods before forwarding", async () => {
    const cases = [
      [new Request("https://api.example.com/private"), 404, "NotFound"],
      [
        new Request("https://api.example.com/query", { method: "DELETE" }),
        405,
        "MethodNotAllowed",
      ],
      [
        new Request("https://api.example.com/health", { method: "POST" }),
        405,
        "MethodNotAllowed",
      ],
    ] as const;

    for (const [request, status, type] of cases) {
      const forwarder = makeForwarder(new Response("unused"));
      const response = await handleWorkerRequest(
        request,
        forwarder.forwardRequest,
        openProtection()
      );
      expect(forwarder.requests).toHaveLength(0);
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get(REQUEST_ID_HEADER)).toMatch(REQUEST_ID_PATTERN);
      expect(await response.json()).toMatchObject({
        error: { type },
        success: false,
      });
    }
  });

  test("preserves downstream status, body, and headers", async () => {
    for (const status of [200, 400, 415, 502, 504]) {
      const downstream = new Response(`downstream-${status}`, {
        headers: {
          "content-type": "application/problem+json",
          "x-container-response": "preserved",
        },
        status,
      });
      const forwarder = makeForwarder(downstream);
      const response = await handleWorkerRequest(
        new Request(
          "https://api.example.com/query?type=minecraft&host=example.com"
        ),
        forwarder.forwardRequest,
        openProtection()
      );
      expect(response).toBe(downstream);
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe(
        "application/problem+json"
      );
      expect(response.headers.get("x-container-response")).toBe("preserved");
      expect(await response.text()).toBe(`downstream-${status}`);
    }
  });

  test("maps thrown and rejected Container failures to a redacted 503", async () => {
    const sensitiveMessage = `binding failed with ${TEST_CREDENTIAL}`;
    const failures = [
      () => {
        throw new Error(sensitiveMessage);
      },
      () => Promise.reject(new Error(sensitiveMessage)),
    ];

    for (const forwardRequest of failures) {
      const response = await handleWorkerRequest(
        new Request("https://api.example.com/health"),
        forwardRequest,
        openProtection()
      );
      const serialized = JSON.stringify(await response.json());
      expect(response.status).toBe(503);
      expect(serialized).toContain("ContainerUnavailable");
      expect(serialized).not.toContain(TEST_CREDENTIAL);
      expect(serialized).not.toContain(sensitiveMessage);
    }
  });
});

describe("Worker authentication", () => {
  test("rejects missing, malformed, and invalid bearer credentials", async () => {
    const headers = [
      undefined,
      "Basic abc",
      "Bearer",
      "Bearer invalid-token",
      `Bearer ${TEST_AUTH_TOKEN} extra`,
    ];

    for (const authorization of headers) {
      const forwarder = makeForwarder(new Response("unused"));
      const requestHeaders = new Headers();
      if (authorization !== undefined) {
        requestHeaders.set("authorization", authorization);
      }
      const response = await handleWorkerRequest(
        new Request(
          "https://api.example.com/query?type=minecraft&host=example.com",
          { headers: requestHeaders }
        ),
        forwarder.forwardRequest,
        protectedWorker()
      );
      const serialized = JSON.stringify(await response.json());
      expect(response.status).toBe(401);
      expect(forwarder.requests).toHaveLength(0);
      expect(serialized).not.toContain(TEST_AUTH_TOKEN);
    }
  });

  test("accepts a valid bearer token and strips Authorization before forwarding", async () => {
    const downstream = Response.json({ success: true });
    const forwarder = makeForwarder(downstream);
    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: {
            authorization: `Bearer ${TEST_AUTH_TOKEN}`,
            "x-client-header": "preserve-me",
          },
        }
      ),
      forwarder.forwardRequest,
      protectedWorker()
    );

    expect(response).toBe(downstream);
    const forwarded = onlyRequest(forwarder.requests);
    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(forwarded.headers.get("x-client-header")).toBe("preserve-me");
  });

  test("keeps /health public while still stripping accidental Authorization", async () => {
    const forwarder = makeForwarder(Response.json({ healthy: true }));
    const response = await handleWorkerRequest(
      new Request("https://api.example.com/health", {
        headers: { authorization: "Bearer not-the-token" },
      }),
      forwarder.forwardRequest,
      { authToken: TEST_AUTH_TOKEN }
    );

    expect(response.status).toBe(200);
    expect(onlyRequest(forwarder.requests).headers.get("authorization")).toBeNull();
  });
});

describe("Worker query rate limiting", () => {
  test("partitions open-mode limits by client IP", async () => {
    const { keys, rateLimit } = makeRateLimit(true);
    const forwarder = makeForwarder(Response.json({ success: true }));
    await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        { headers: { "cf-connecting-ip": "203.0.113.7" } }
      ),
      forwarder.forwardRequest,
      { authToken: "", rateLimit }
    );
    expect(keys).toEqual(["ip:203.0.113.7"]);
    expect(forwarder.requests).toHaveLength(1);
  });

  test("uses a stable non-secret token identity for authenticated limits", async () => {
    const { keys, rateLimit } = makeRateLimit(true);
    const forwarder = makeForwarder(Response.json({ success: true }));
    await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        { headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` } }
      ),
      forwarder.forwardRequest,
      { authToken: TEST_AUTH_TOKEN, rateLimit }
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^token:[0-9a-f]{64}$/u);
    expect(keys[0]).not.toContain(TEST_AUTH_TOKEN);
  });

  test("returns 429 without forwarding when the rate limit is exhausted", async () => {
    const { rateLimit } = makeRateLimit(false);
    const forwarder = makeForwarder(new Response("unused"));
    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        { headers: { "cf-connecting-ip": "203.0.113.8" } }
      ),
      forwarder.forwardRequest,
      { authToken: "", rateLimit }
    );
    expect(response.status).toBe(429);
    expect(forwarder.requests).toHaveLength(0);
    expect(await response.json()).toMatchObject({
      error: { type: "RateLimited" },
      success: false,
    });
  });

  test("fails closed when rate limiting is missing or throws, without leaking details", async () => {
    const protections: WorkerProtection[] = [
      { authToken: "" },
      {
        authToken: TEST_AUTH_TOKEN,
        rateLimit: {
          limit: () =>
            Promise.reject(
              new Error(`rate limit failure with ${TEST_AUTH_TOKEN}`)
            ),
        },
      },
    ];

    for (const protection of protections) {
      const forwarder = makeForwarder(new Response("unused"));
      const headers = new Headers();
      if (protection.authToken.length > 0) {
        headers.set("authorization", `Bearer ${TEST_AUTH_TOKEN}`);
      }
      const response = await handleWorkerRequest(
        new Request(
          "https://api.example.com/query?type=minecraft&host=example.com",
          { headers }
        ),
        forwarder.forwardRequest,
        protection
      );
      const serialized = JSON.stringify(await response.json());
      expect(response.status).toBe(503);
      expect(forwarder.requests).toHaveLength(0);
      expect(serialized).toContain("RateLimitUnavailable");
      expect(serialized).not.toContain(TEST_AUTH_TOKEN);
    }
  });
});
