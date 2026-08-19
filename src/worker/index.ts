import { Container, getContainer } from "@cloudflare/containers";
import type * as Cloudflare from "alchemy/Cloudflare";

import type { Worker } from "../../alchemy.run.ts";

/** Container-backed Durable Object that owns the POC process lifecycle. */
export class KzgContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = true;
}

const routes = new Set(["/health", "/query"]);

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
              message: "Supported routes: /health, /query",
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
