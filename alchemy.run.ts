import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import type { KzgContainer as KzgContainerClass } from "./src/worker/index.ts";

const target = {
  host: process.env.CS2_HOST ?? "103.212.227.45",
  port: process.env.CS2_PORT ?? "27015",
  timeout: process.env.A2S_TIMEOUT ?? "5000",
};

/** Container application built from the repository Dockerfile. */
const KzgContainer = Cloudflare.Container<KzgContainerClass>("KzgContainer", {
  className: "KzgContainer",
  context: import.meta.dirname,
  dockerfile: "Dockerfile",
  instanceType: "lite",
  instances: 0,
  maxInstances: 1,
  observability: { logs: { enabled: true } },
});

/** Public edge Worker and its Container/config bindings. */
export const Worker = Cloudflare.Worker("KzgGameDigPoc", {
  compatibility: {
    date: "2026-08-19",
    flags: ["nodejs_compat"],
  },
  env: {
    A2S_TIMEOUT: target.timeout,
    CONTAINER: KzgContainer,
    CS2_HOST: target.host,
    CS2_PORT: target.port,
  },
  main: "./src/worker/index.ts",
  observability: { enabled: true },
});

export default Alchemy.Stack(
  "KzgGameDigContainerPoc",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const worker = yield* Worker;
    return { url: worker.url };
  })
);
