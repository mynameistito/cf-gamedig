import { afterAll, describe, expect, test } from "bun:test";

import { disposeRuntime, handleRequest } from "../src/container/server.ts";

afterAll(async () => {
  await disposeRuntime();
});

const requestQuery = async (query: string) => {
  const response = await handleRequest(
    new Request(`https://container.local/query?${query}`)
  );
  const body: unknown = await response.json();

  return { body, response };
};

describe("/query validation", () => {
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
});
