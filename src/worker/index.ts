import { Container, getContainer } from "@cloudflare/containers";
import type { InferEnv } from "alchemy/Cloudflare";

import type { Worker } from "../../alchemy.run.ts";
import { handleWorkerRequest } from "./handler.ts";

export class GameDigContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = true;
}

export default {
  fetch(request: Request, env: InferEnv<typeof Worker>): Promise<Response> {
    return handleWorkerRequest(
      request,
      (forwardedRequest) =>
        getContainer(env.CONTAINER, "cf-gamedig").fetch(forwardedRequest),
      {
        authToken: env.WORKER_AUTH_TOKEN,
        rateLimit: env.QUERY_RATE_LIMIT,
      }
    );
  },
};
