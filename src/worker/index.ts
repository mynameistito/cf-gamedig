import { Container, getContainer } from "@cloudflare/containers";
import type * as Cloudflare from "alchemy/Cloudflare";

import type { Worker } from "../../alchemy.run.ts";

interface ContainerEnvironment {
  readonly CS2_HOST: string;
  readonly CS2_PORT: string;
  readonly A2S_TIMEOUT: string;
}

/** Container-backed Durable Object that owns the POC process lifecycle. */
export class KzgContainer extends Container<ContainerEnvironment> {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = true;
  override envVars = {
    A2S_TIMEOUT: this.env.A2S_TIMEOUT,
    CS2_HOST: this.env.CS2_HOST,
    CS2_PORT: this.env.CS2_PORT,
  };
}

const routes = new Set(["/health", "/raw-a2s", "/gamedig"]);

export default {
  fetch(
    request: Request,
    env: Cloudflare.InferEnv<typeof Worker>
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || !routes.has(url.pathname)) {
      return Promise.resolve(
        Response.json(
          {
            error: {
              message: "Supported routes: /health, /raw-a2s, /gamedig",
              type: "NotFound",
            },
            success: false,
          },
          { status: 404 }
        )
      );
    }

    return getContainer(env.CONTAINER, "kzg-poc").fetch(request);
  },
};
