import { describe, expect, test } from "bun:test";
import { Console, Effect } from "effect";

import { containerLoggingLayer } from "@/container/logging.ts";

describe("container logging", () => {
  test("emits annotated Effect events as one compact JSON line", async () => {
    const output: unknown[] = [];
    const testConsole: Console.Console = Object.assign(Object.create(console), {
      log: (...args: ReadonlyArray<unknown>) => {
        output.push(...args);
      },
    });

    await Effect.runPromise(
      Effect.logInfo("Container HTTP request completed").pipe(
        Effect.annotateLogs({
          elapsedMs: 4007,
          event: "container_http_completed",
          method: "GET",
          requestId: "test-request-id",
          route: "/query",
          status: 504,
        }),
        Effect.provide(containerLoggingLayer),
        Effect.provideService(Console.Console, testConsole)
      )
    );

    expect(output).toHaveLength(1);
    const line = output[0];
    expect(typeof line).toBe("string");
    if (typeof line !== "string") {
      throw new TypeError("Expected a single string log line");
    }

    expect(line).not.toMatch(/[\r\n]/u);
    const parsed: unknown = JSON.parse(line);
    expect(parsed).toMatchObject({
      annotations: {
        elapsedMs: 4007,
        event: "container_http_completed",
        method: "GET",
        requestId: "test-request-id",
        route: "/query",
        status: 504,
      },
      level: "INFO",
      message: "Container HTTP request completed",
    });
  });
});
