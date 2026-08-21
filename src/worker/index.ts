import { Container, getContainer } from "@cloudflare/containers";
import type { StopParams } from "@cloudflare/containers";
import type { InferEnv } from "alchemy/Cloudflare";

import { makeHttpLogPresentation } from "@/http-logging.ts";
import type { HttpCompletionMetadata } from "@/request-correlation.ts";

import type { Worker } from "../../alchemy.run.ts";
import { handleWorkerRequest } from "./handler.ts";

const logWorkerHttpCompletion = (metadata: HttpCompletionMetadata): void => {
  const presentation = makeHttpLogPresentation("Worker", metadata);
  const line = JSON.stringify({
    event: "worker_http_completed",
    message: presentation.message,
    ...metadata,
  });

  switch (presentation.level) {
    case "error": {
      console.error(line);
      break;
    }
    case "warn": {
      console.warn(line);
      break;
    }
    default: {
      console.info(line);
    }
  }
};

export class GameDigContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = true;

  override onStart(this: GameDigContainer): void {
    console.info(
      JSON.stringify({
        containerClass: this.constructor.name,
        event: "container_lifecycle_started",
      })
    );
  }

  override onStop(
    this: GameDigContainer,
    { exitCode, reason }: StopParams
  ): void {
    console.info(
      JSON.stringify({
        containerClass: this.constructor.name,
        event: "container_lifecycle_stopped",
        exitCode,
        reason,
      })
    );
  }

  override onError(
    this: GameDigContainer,
    ...args: Parameters<Container["onError"]>
  ): never {
    console.error(
      JSON.stringify({
        containerClass: this.constructor.name,
        event: "container_lifecycle_error",
      })
    );
    throw args[0];
  }
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
      },
      logWorkerHttpCompletion
    );
  },
};
