import { Container, getContainer } from "@cloudflare/containers";
import type { InferEnv } from "alchemy/Cloudflare";

import type { Worker } from "../../alchemy.run.ts";

export class GameDigContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = true;
}

const isAllowedRequest = (request: Request, pathname: string): boolean => {
  if (request.method === "POST") {
    return pathname === "/query";
  }
  if (request.method !== "GET") {
    return false;
  }
  return pathname === "/health" || pathname === "/query";
};

export default {
  fetch(
    request: Request,
    env: InferEnv<typeof Worker>
  ): Response | Promise<Response> {
    const url = new URL(request.url);
    if (!isAllowedRequest(request, url.pathname)) {
      return Response.json(
        {
          error: {
            message: "Supported routes: /health, /query",
            type: "NotFound",
          },
          success: false,
        },
        { status: 404 }
      );
    }

    return getContainer(env.CONTAINER, "cf-gamedig").fetch(request);
  },
};
