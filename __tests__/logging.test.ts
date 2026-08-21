import { describe, expect, test } from "bun:test";

import { Console, Effect } from "effect";

import {
  containerLoggingLayer,
  logContainerHttpCompletion,
} from "@/container/logging.ts";
import { makeHttpLogPresentation } from "@/http-logging.ts";
import type { HttpCompletionMetadata } from "@/request-correlation.ts";

interface CapturedConsoleCall {
  readonly line: string;
  readonly method: "error" | "info" | "warn";
}

const captureContainerCompletion = async (metadata: HttpCompletionMetadata) => {
  const calls: CapturedConsoleCall[] = [];
  const record = (method: CapturedConsoleCall["method"]) =>
    (...args: readonly unknown[]): void => {
      const [line = ""] = args;
      calls.push({ line: String(line), method });
    };
  const testConsole: Console.Console = Object.assign(Object.create(console), {
    error: record("error"),
    info: record("info"),
    warn: record("warn"),
  });

  await Effect.runPromise(
    logContainerHttpCompletion(metadata).pipe(
      Effect.provide(containerLoggingLayer),
      Effect.provideService(Console.Console, testConsole)
    )
  );

  return calls;
};

describe("HTTP logging", () => {
  test("formats Worker and Container traffic summaries", () => {
    const metadata: HttpCompletionMetadata = {
      elapsedMs: 31,
      method: "GET",
      requestId: "test-request-id",
      route: "/query",
      status: 200,
    };

    expect(makeHttpLogPresentation("Worker", metadata)).toEqual({
      level: "info",
      message: "Worker GET /query 200 31ms",
    });
    expect(makeHttpLogPresentation("Container", metadata)).toEqual({
      level: "info",
      message: "Container GET /query 200 31ms",
    });
  });

  test("maps HTTP status classes to Cloudflare console severity", async () => {
    const cases = [
      [200, "info", "INFO"],
      [302, "info", "INFO"],
      [404, "warn", "WARN"],
      [504, "error", "ERROR"],
    ] as const;

    const results = await Promise.all(
      cases.map(async ([status, method, level]) => ({
        calls: await captureContainerCompletion({
          elapsedMs: 4007,
          method: "GET",
          requestId: "test-request-id",
          route: "/query",
          status,
        }),
        level,
        method,
        status,
      }))
    );

    for (const { calls, level, method, status } of results) {
      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(call).toBeDefined();
      expect(call?.method).toBe(method);
      expect(call?.line).not.toMatch(/[\r\n]/u);

      const parsed: unknown = JSON.parse(call?.line ?? "null");
      expect(parsed).toMatchObject({
        annotations: {
          elapsedMs: 4007,
          event: "container_http_completed",
          method: "GET",
          requestId: "test-request-id",
          route: "/query",
          status,
        },
        level,
        message: `Container GET /query ${status} 4007ms`,
      });
    }
  });
});
