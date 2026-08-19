import { describe, expect, test } from "bun:test";

import { handleWorkerRequest } from "../src/worker/index.ts";

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
  const request = requests[0];
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

    const response = await handleWorkerRequest(request, forwardRequest);

    expect(response).toBe(downstreamResponse);
    expect(getOnlyRequest(requests)).toBe(request);
  });

  test("forwards GET /query with the query string intact", async () => {
    const downstreamResponse = Response.json({ success: true });
    const { forwardRequest, requests } = makeForwarder(downstreamResponse);
    const request = new Request(
      "https://api.example.com/query?type=minecraft&host=example.com&port=25565"
    );

    await handleWorkerRequest(request, forwardRequest);

    const forwardedRequest = getOnlyRequest(requests);
    expect(forwardedRequest.method).toBe("GET");
    expect(forwardedRequest.url).toBe(request.url);
  });

  test("forwards POST /query body and content type intact", async () => {
    const downstreamResponse = Response.json({ success: true });
    const { forwardRequest, requests } = makeForwarder(downstreamResponse);
    const body = JSON.stringify({
      host: "example.com",
      options: { password: "TEST_CREDENTIAL" },
      type: "palworld",
    });
    const request = new Request("https://api.example.com/query", {
      body,
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
    });

    await handleWorkerRequest(request, forwardRequest);

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
      forwardRequest
    );
    const body: unknown = await response.json();

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
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
      forwardRequest
    );
    const body: unknown = await response.json();

    expect(requests).toHaveLength(0);
    expect(response.status).toBe(405);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: { message: "Method not allowed", type: "MethodNotAllowed" },
      success: false,
    });
  });

  test("preserves downstream Container responses without rewriting error statuses", async () => {
    for (const status of [400, 415, 502, 504]) {
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
        new Request("https://api.example.com/query?type=minecraft&host=example.com"),
        forwardRequest
      );

      expect(response).toBe(downstreamResponse);
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe(
        "application/problem+json"
      );
      expect(response.headers.get("x-container-response")).toBe("preserved");
      expect(await response.text()).toBe(responseBody);
    }
  });

  test("translates thrown and rejected forwarding failures into a stable 503", async () => {
    const sensitiveMessage = "binding failed with password=TEST_CREDENTIAL";
    const failingForwarders = [
      () => {
        throw new Error(sensitiveMessage);
      },
      () => Promise.reject(new Error(sensitiveMessage)),
    ];

    for (const forwardRequest of failingForwarders) {
      const response = await handleWorkerRequest(
        new Request("https://api.example.com/health"),
        forwardRequest
      );
      const body: unknown = await response.json();
      const serializedBody = JSON.stringify(body);

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(body).toEqual({
        error: {
          message: "GameDig service temporarily unavailable",
          type: "ContainerUnavailable",
        },
        success: false,
      });
      expect(serializedBody).not.toContain(sensitiveMessage);
      expect(serializedBody).not.toContain("TEST_CREDENTIAL");
      expect(serializedBody).not.toContain("binding");
    }
  });
});
