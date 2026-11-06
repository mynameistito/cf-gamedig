import {
  Container,
  RateLimit,
  Worker as WorkerResource,
  providers,
} from "@alchemy.run/cloudflare";
import { Stack, localState } from "alchemy";
import { Config, Effect, Result } from "effect";

import { parseRateLimitNamespace } from "./src/rate-limit-namespace.ts";
import type { GameDigContainer } from "./src/worker/index.ts";

const rateLimitNamespace = parseRateLimitNamespace(
  process.env.CF_GAMEDIG_RATE_LIMIT_NAMESPACE_ID
);

if (Result.isFailure(rateLimitNamespace)) {
  throw new Error(rateLimitNamespace.failure);
}

const container = Container<GameDigContainer>("cf-gamedig-container", {
  className: "GameDigContainer",
  context: import.meta.dirname,
  dockerfile: "Dockerfile",
  env: {
    CF_GAMEDIG_TARGET_POLICY: Config.String("CF_GAMEDIG_TARGET_POLICY").pipe(
      Config.withDefault("open")
    ),
  },
  instanceType: "lite",
  instances: 0,
  maxInstances: 1,
  observability: { logs: { enabled: true } },
});

const queryRateLimit = RateLimit("QUERY_RATE_LIMIT", {
  namespaceId: rateLimitNamespace.success,
  simple: {
    limit: 10,
    period: 60,
  },
});

export const Worker = WorkerResource("cf-gamedig-worker", {
  compatibility: {
    date: "2026-07-11",
    flags: ["nodejs_compat"],
  },
  env: {
    CONTAINER: container,
    QUERY_RATE_LIMIT: queryRateLimit,
    WORKER_AUTH_TOKEN: Config.Redacted("CF_GAMEDIG_AUTH_TOKEN").pipe(
      Config.withDefault("")
    ),
  },
  main: "./src/worker/index.ts",
  observability: { enabled: true },
});

export default Stack(
  "cf-gamedig-container",
  {
    providers: providers(),
    state: localState(),
  },
  Effect.gen(function* runStack() {
    const worker = yield* Worker;

    return { url: worker.url };
  })
);
