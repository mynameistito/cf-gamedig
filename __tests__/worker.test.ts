import { describe, expect, test } from "bun:test";

import {
  CLOUDFLARE_RAY_HEADER,
  CLOUDFLARE_REQUEST_ID_HEADER,
  INTERNAL_REQUEST_ID_HEADER,
  REQUEST_ID_HEADER,
} from "../src/request-correlation.ts";
import { handleWorkerRequest } from "../src/worker/handler.ts";
import type { WorkerProtection } from "../src/worker/handler.ts";

const TEST_CREDENTIAL = ["TEST", "CREDENTIAL"].join("_");
const TEST_AUTH_TOKEN = ["TEST", "AUTH", "TOKEN"].join("_");

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

const makeForwarder = (downstreamResponse: Response) => {
  const requests: Request[] = [];
  const forwardRequest = (request: Request): Response => {
    requests.push(request);
    return downstreamResponse;
  };

  return { forwardRequest, requests };
};

const getOnlyRequest = (requests: readonly Request[]): Request => {
  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (request === undefined) {
    throw new Error("Expected one forwarded request");
  }
  return request;
};

describe("Worker forwarding boundary", () => {
  test("forwards GET /health", async () => {
    const downstreamResponse = Response.json({ healthy: true });
    const { forwardRequest, requests } = makeForwarder(downstreamResponse);
    const request = new Request("https://api.example.com/health", {
      headers: { "x-request-id": "health-request" },
    });

    const response = await handleWorkerRequest(
      request,
      forwardRequest,
      openProtection()
    );

    expect(response).toBe(downstreamResponse);
    expect(getOnlyRequest(requests)).toBe(request);
  });

  test("forwards GET /query with the query string intact in open mode", async () => {
    const downstreamResponse = Response.json({ success: true });
    const { forwardRequest, requests } = makeForwarder(downstreamResponse);
    const request = new Request(
      "https://api.example.com/query?type=minecraft&host=example.com&port=25565"
    );

    await handleWorkerRequest(request, forwardRequest, openProtection());

    const forwardedRequest = getOnlyRequest(requests);
    expect(forwardedRequest.method).toBe("GET");
    expect(forwardedRequest.url).toBe(request.url);
  });

  test("forwards POST /query body and content type intact", async () => {
    const downstreamResponse = Response.json({ success: true });
    const { forwardRequest, requests } = makeForwarder(downstreamResponse);
    const body = JSON.stringify({
      host: "example.com",
      options: { password: TEST_CREDENTIAL },
      type: "palworld",
    });
    const request = new Request("https://api.example.com/query", {
      body,
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
    });

    await handleWorkerRequest(request, forwardRequest, openProtection());

    const forwardedRequest = getOnlyRequest(requests);
    expect(forwardedRequest).toBe(request);
    expect(forwardedRequest.method).toBe("POST");
    expect(forwardedRequest.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    expect(await forwardedRequest.text()).toBe(body);
  });

  test("rejects unsupported routes at the Worker without forwarding", async () => {
    const { forwardRequest, requests } = makeForwarder(new Response("unused"));

    const response = await handleWorkerRequest(
      new Request("https://api.example.com/private"),
      forwardRequest,
      openProtection()
    );
    const body: unknown = await response.json();

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      error: {
        message: "Supported routes: /health, /query",
        type: "NotFound",
      },
      success: false,
    });
  });

  test("rejects unsupported methods at the Worker without forwarding", async () => {
    const { forwardRequest, requests } = makeForwarder(new Response("unused"));

    const response = await handleWorkerRequest(
      new Request("https://api.example.com/query", { method: "DELETE" }),
      forwardRequest,
      openProtection()
    );
    const body: unknown = await response.json();

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      error: { message: "Method not allowed", type: "MethodNotAllowed" },
      success: false,
    });
  });

  test("preserves downstream Container responses without rewriting error statuses", async () => {
    const results = await Promise.all(
      [400, 415, 502, 504].map(async (status) => {
        const responseBody = `downstream-${status}`;
        const downstreamResponse = new Response(responseBody, {
          headers: {
            "content-type": "application/problem+json",
            "x-container-response": "preserved",
          },
          status,
        });
        const { forwardRequest } = makeForwarder(downstreamResponse);
        const response = await handleWorkerRequest(
          new Request(
            "https://api.example.com/query?type=minecraft&host=example.com"
          ),
          forwardRequest,
          openProtection()
        );
        const body = await response.text();

        return { body, downstreamResponse, response, responseBody, status };
      })
    );

    for (const result of results) {
      expect(result.response).toBe(result.downstreamResponse);
      expect(result.response.status).toBe(result.status);
      expect(result.response.headers.get("content-type")).toBe(
        "application/problem+json"
      );
      expect(result.response.headers.get("x-container-response")).toBe(
        "preserved"
      );
      expect(result.body).toBe(result.responseBody);
    }
  });

  test("translates thrown and rejected forwarding failures into a stable 503", async () => {
    const sensitiveMessage = [
      "binding failed with credential=",
      TEST_CREDENTIAL,
    ].join("");
    const failingForwarders = [
      () => {
        throw new Error(sensitiveMessage);
      },
      () => Promise.reject(new Error(sensitiveMessage)),
    ];
    const results = await Promise.all(
      failingForwarders.map(async (forwardRequest) => {
        const response = await handleWorkerRequest(
          new Request("https://api.example.com/health"),
          forwardRequest,
          openProtection()
        );
        const body: unknown = await response.json();
        return { body, response };
      })
    );

    for (const { body, response } of results) {
      const serializedBody = JSON.stringify(body);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body).toMatchObject({
        error: {
          message: "GameDig service temporarily unavailable",
          type: "ContainerUnavailable",
        },
        success: false,
      });
      expect(serializedBody).not.toContain(sensitiveMessage);
      expect(serializedBody).not.toContain(TEST_CREDENTIAL);
      expect(serializedBody).not.toContain("binding");
    }
  });
});

describe("Worker authentication", () => {
  test("rejects missing credentials before forwarding", async () => {
    const { forwardRequest, requests } = makeForwarder(new Response("unused"));

    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com"
      ),
      forwardRequest,
      protectedWorker()
    );
    const body: unknown = await response.json();

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      error: {
        message: "Missing or invalid bearer token",
        type: "Unauthorized",
      },
      success: false,
    });
  });

  test("rejects invalid credentials before forwarding without exposing secrets", async () => {
    const { forwardRequest, requests } = makeForwarder(new Response("unused"));
    const invalidToken = ["INVALID", TEST_AUTH_TOKEN].join("_");

    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: { authorization: `Bearer ${invalidToken}` },
        }
      ),
      forwardRequest,
      protectedWorker()
    );
    const body: unknown = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(401);
    expect(serializedBody).not.toContain(TEST_AUTH_TOKEN);
    expect(serializedBody).not.toContain(invalidToken);
  });

  test("accepts valid bearer credentials", async () => {
    const downstreamResponse = Response.json({ success: true });
    const { forwardRequest, requests } = makeForwarder(downstreamResponse);

    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
        }
      ),
      forwardRequest,
      protectedWorker()
    );

    expect(response).toBe(downstreamResponse);
    expect(requests).toHaveLength(1);
  });

  test("strips Authorization before forwarding to the Container", async () => {
    const { forwardRequest, requests } = makeForwarder(
      Response.json({ success: true })
    );

    await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: {
            authorization: `Bearer ${TEST_AUTH_TOKEN}`,
            "x-request-id": "protected-query",
          },
        }
      ),
      forwardRequest,
      protectedWorker()
    );

    const forwardedRequest = getOnlyRequest(requests);
    expect(forwardedRequest.headers.get("authorization")).toBeNull();
    expect(forwardedRequest.headers.get("x-request-id")).toBe(
      "protected-query"
    );
  });

  test("keeps /health public and strips Authorization without rate limiting", async () => {
    const downstreamResponse = Response.json({ healthy: true });
    const { forwardRequest, requests } = makeForwarder(downstreamResponse);

    const response = await handleWorkerRequest(
      new Request("https://api.example.com/health", {
        headers: { authorization: "Bearer not-the-token" },
      }),
      forwardRequest,
      { authToken: TEST_AUTH_TOKEN }
    );

    expect(response).toBe(downstreamResponse);
    expect(getOnlyRequest(requests).headers.get("authorization")).toBeNull();
  });
});

describe("Worker query rate limiting", () => {
  test("allows a request before forwarding and partitions open mode by client IP", async () => {
    const { keys, rateLimit } = makeRateLimit(true);
    const { forwardRequest, requests } = makeForwarder(
      Response.json({ success: true })
    );

    await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: { "cf-connecting-ip": "203.0.113.7" },
        }
      ),
      forwardRequest,
      { authToken: "", rateLimit }
    );

    expect(keys).toEqual(["ip:203.0.113.7"]);
    expect(requests).toHaveLength(1);
  });

  test("uses a stable non-secret token identity for authenticated rate limits", async () => {
    const { keys, rateLimit } = makeRateLimit(true);
    const { forwardRequest } = makeForwarder(Response.json({ success: true }));

    await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
        }
      ),
      forwardRequest,
      { authToken: TEST_AUTH_TOKEN, rateLimit }
    );

    expect(keys).toHaveLength(1);
    expect(keys[0]?.startsWith("token:")).toBe(true);
    expect(keys[0]).not.toContain(TEST_AUTH_TOKEN);
  });

  test("returns a stable 429 and does not contact the Container when blocked", async () => {
    const { rateLimit } = makeRateLimit(false);
    const { forwardRequest, requests } = makeForwarder(new Response("unused"));

    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: { "cf-connecting-ip": "203.0.113.8" },
        }
      ),
      forwardRequest,
      { authToken: "", rateLimit }
    );
    const body: unknown = await response.json();

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBeNull();
    expect(body).toMatchObject({
      error: {
        message: "Query rate limit exceeded",
        type: "RateLimited",
      },
      success: false,
    });
  });

  test("fails closed with a stable 503 when the expected rate-limit binding is missing", async () => {
    const { forwardRequest, requests } = makeForwarder(new Response("unused"));

    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com"
      ),
      forwardRequest,
      { authToken: "" }
    );
    const body: unknown = await response.json();

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      error: {
        message: "Query rate limiting is unavailable",
        type: "RateLimitUnavailable",
      },
      success: false,
    });
  });

  test("redacts rate-limit failures and does not contact the Container", async () => {
    const sensitiveMessage = `rate limit binding failed with ${TEST_AUTH_TOKEN}`;
    const rateLimit: NonNullable<WorkerProtection["rateLimit"]> = {
      limit: () => Promise.reject(new Error(sensitiveMessage)),
    };
    const { forwardRequest, requests } = makeForwarder(new Response("unused"));

    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
        }
      ),
      forwardRequest,
      { authToken: TEST_AUTH_TOKEN, rateLimit }
    );
    const body: unknown = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(503);
    expect(serializedBody).not.toContain(TEST_AUTH_TOKEN);
    expect(serializedBody).not.toContain(sensitiveMessage);
  });
});

describe("Worker response metadata", () => {
  const ISO_TIMESTAMP_PATTERN =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

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

  const correlatedErrorBody = async (
    request: Request,
    protection: WorkerProtection,
    forwardRequest: (
      request: Request
    ) => Response | Promise<Response> = makeForwarder(new Response("unused"))
      .forwardRequest
  ): Promise<{
    readonly body: { readonly metadata?: unknown };
    readonly requestId: string;
  }> => {
    const response = await handleWorkerRequest(
      request,
      forwardRequest,
      protection
    );
    // SAFETY: Worker JSON responses are plain objects; the metadata contract is
    // asserted by validateMetadata immediately below.
    const body = (await response.json()) as { readonly metadata?: unknown };
    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).not.toBeNull();
    validateMetadata(body, requestId ?? "");
    return { body, requestId: requestId ?? "" };
  };

  test("404 responses contain correlated metadata", async () => {
    const { forwardRequest, requests } = makeForwarder(new Response("unused"));

    await correlatedErrorBody(
      new Request("https://api.example.com/private"),
      openProtection(),
      forwardRequest
    );

    expect(requests).toHaveLength(0);
  });

  test("405 responses contain correlated metadata", async () => {
    await correlatedErrorBody(
      new Request("https://api.example.com/query", { method: "DELETE" }),
      openProtection()
    );
  });

  test("401 responses contain correlated metadata", async () => {
    await correlatedErrorBody(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com"
      ),
      protectedWorker()
    );
  });

  test("429 responses contain correlated metadata", async () => {
    const { rateLimit } = makeRateLimit(false);
    await correlatedErrorBody(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        { headers: { "cf-connecting-ip": "203.0.113.8" } }
      ),
      { authToken: "", rateLimit }
    );
  });

  test("rate-limit-unavailable responses contain correlated metadata", async () => {
    await correlatedErrorBody(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com"
      ),
      { authToken: "" }
    );
  });

  test("container-unavailable responses contain correlated metadata", async () => {
    await correlatedErrorBody(
      new Request("https://api.example.com/health"),
      openProtection(),
      () => Promise.reject(new Error("down"))
    );
  });

  test("uses the Cloudflare ray ID as the authoritative request ID when present", async () => {
    const rayId = "9ab9830f8f01234f-sjc";
    const requests: Request[] = [];
    const completions: { readonly requestId?: string }[] = [];

    const response = await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        { headers: { [CLOUDFLARE_RAY_HEADER]: rayId } }
      ),
      (request) => {
        requests.push(request);
        return Response.json({ success: true });
      },
      openProtection(),
      (metadata) => completions.push(metadata)
    );

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(rayId);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get(INTERNAL_REQUEST_ID_HEADER)).toBe(rayId);
    expect(completions).toEqual([
      expect.objectContaining({ requestId: rayId }),
    ]);
  });

  test("prefers cf-request-id over CF-Ray", async () => {
    const requestId = "a".repeat(32);
    const rayId = "b".repeat(16);
    const requests: Request[] = [];

    await handleWorkerRequest(
      new Request(
        "https://api.example.com/query?type=minecraft&host=example.com",
        {
          headers: {
            [CLOUDFLARE_REQUEST_ID_HEADER]: requestId,
            [CLOUDFLARE_RAY_HEADER]: rayId,
          },
        }
      ),
      (request) => {
        requests.push(request);
        return Response.json({ success: true });
      },
      openProtection()
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get(INTERNAL_REQUEST_ID_HEADER)).toBe(
      requestId
    );
  });
});
