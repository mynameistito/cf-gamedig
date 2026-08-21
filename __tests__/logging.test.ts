import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TestConsole } from "effect/testing";

import { containerLoggingLayer } from "@/container/logging.ts";

describe("container logging", () => {
  test("emits annotated Effect events as one compact JSON line", async () => {
    const output = await Effect.runPromise(
      Effect.gen(function* captureLogOutput() {
        yield* Effect.logInfo("Container HTTP request completed").pipe(
          Effect.annotateLogs({
            elapsedMs: 4007,
            event: "container_http_completed",
            method: "GET",
            requestId: "test-request-id",
            route: "/query",
            status: 504,
          }),
          Effect.provide(containerLoggingLayer)
        );
        return yield* TestConsole.logLines;
      }).pipe(Effect.provide(TestConsole.layer))
    );

    expect(output).toHaveLength(1);
    const [line = ""] = output;
    const serialized = String(line);
    expect(serialized).not.toMatch(/[\r\n]/u);

    const parsed: unknown = JSON.parse(serialized);
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
