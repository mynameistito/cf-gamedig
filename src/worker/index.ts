import type { InferEnv } from "@alchemy.run/cloudflare";
import { Container, getContainer } from "@cloudflare/containers";
import type { StopParams } from "@cloudflare/containers";

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

    case "info": {
      console.info(line);
      break;
    }

    default: {
      throw new Error("Unexpected log level");
    }
  }
};

/**
 * Durable Object that hosts the GameDig container.
 */
export class GameDigContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = true;

  /**
   * Log the container start event.
   */
  override onStart(this: GameDigContainer): void {
    console.info(
      JSON.stringify({
        containerClass: this.constructor.name,
        event: "container_lifecycle_started",
      })
    );
  }

  /**
   * Log the container stop event.
   * @param exitCode - Exit status from the container.
   * @param reason - Reason for stopping.
   */
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

  /**
   * Log and rethrow a container lifecycle error.
   * @param args - Error arguments from the container runtime.
   * @throws The original lifecycle error.
   */
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
  // oxlint-disable-next-line typescript/promise-function-async -- Preserve the handler promise and synchronous throws.
  fetch(request: Request, env: InferEnv<typeof Worker>): Promise<Response> {
    return handleWorkerRequest(
      request,
      // oxlint-disable-next-line typescript/promise-function-async -- Preserve the container fetch promise.
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
