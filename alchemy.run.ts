import { Stack, localState } from "alchemy";
import {
  Container,
  Worker as WorkerResource,
  providers,
} from "alchemy/Cloudflare";
import { Effect } from "effect";

import type { GameDigContainer as GameDigContainerClass } from "./src/worker/index.ts";

/** Container application built from the repository Dockerfile. */
const GameDigContainer = Container<GameDigContainerClass>(
  "cf-gamedig-container",
  {
    className: "GameDigContainer",
    context: import.meta.dirname,
    dockerfile: "Dockerfile",
    instanceType: "lite",
    instances: 0,
    maxInstances: 1,
    observability: { logs: { enabled: true } },
  }
);

/** Public edge Worker and its Container/config bindings. */
export const Worker = WorkerResource("cf-gamedig-worker", {
  compatibility: {
    date: "2026-07-11",
    flags: ["nodejs_compat"],
  },
  env: {
    CONTAINER: GameDigContainer,
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
