import { Container, getContainer } from "@cloudflare/containers";
import type { InferEnv } from "alchemy/Cloudflare";

import type { Worker } from "../../alchemy.run.ts";

export class GameDigContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = true;
}

type ForwardRequest = (request: Request) => Response | Promise<Response>;
type WorkerErrorType = "ContainerUnavailable" | "MethodNotAllowed" | "NotFound";

const errorResponse = (
  message: string,
  type: WorkerErrorType,
  status: number
): Response =>
  Response.json(
    {
      error: { message, type },
      success: false,
    },
    {
      headers: { "cache-control": "no-store" },
      status,
    }
  );

const isAllowedMethod = (method: string, pathname: string): boolean => {
  if (pathname === "/health") {
    return method === "GET";
  }
  return method === "GET" || method === "POST";
};

/**
 * Handles the public Worker route contract and forwards allowed requests through
 * the supplied Container boundary.
 *
 * @param request - The incoming public Worker request.
 * @param forwardRequest - The concrete Container forwarding function.
 * @returns The downstream response or a Worker-generated boundary error.
 */
export const handleWorkerRequest = async (
  request: Request,
  forwardRequest: ForwardRequest
): Promise<Response> => {
  const { pathname } = new URL(request.url);

  if (pathname !== "/health" && pathname !== "/query") {
    return errorResponse("Supported routes: /health, /query", "NotFound", 404);
  }

  if (!isAllowedMethod(request.method, pathname)) {
    return errorResponse("Method not allowed", "MethodNotAllowed", 405);
  }

  try {
    return await forwardRequest(request);
  } catch {
    return errorResponse(
      "GameDig service temporarily unavailable",
      "ContainerUnavailable",
      503
    );
  }
};

export default {
  fetch(request: Request, env: InferEnv<typeof Worker>): Promise<Response> {
    return handleWorkerRequest(request, (forwardedRequest) =>
      getContainer(env.CONTAINER, "cf-gamedig").fetch(forwardedRequest)
    );
  },
};
