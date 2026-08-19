import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import type { GameDigContainer as GameDigContainerClass } from "./src/worker/index.ts";

/** Container application built from the repository Dockerfile. */
const GameDigContainer = Cloudflare.Container<GameDigContainerClass>(
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
export const Worker = Cloudflare.Worker("cf-gamedig-worker", {
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

export default Alchemy.Stack(
  "cf-gamedig-container",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* Worker;
    return { url: worker.url };
  })
);
