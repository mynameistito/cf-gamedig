import {
  CLOUDFLARE_RAY_HEADER,
  createRequestId,
  INTERNAL_REQUEST_ID_HEADER,
  makeHttpCompletionMetadata,
  makeResponseMetadata,
  readCloudflareRequestId,
  withRequestIdHeader,
} from "@/request-correlation.ts";
import type { HttpCompletionMetadata } from "@/request-correlation.ts";

type ForwardRequest = (request: Request) => Response | Promise<Response>;

type RecordHttpCompletion = (metadata: HttpCompletionMetadata) => void;

interface QueryRateLimit {
  readonly limit: (options: {
    readonly key: string;
  }) => Promise<{ readonly success: boolean }>;
}

export interface WorkerProtection {
  readonly authToken: string;
  readonly rateLimit?: QueryRateLimit;
}

type WorkerErrorType =
  | "ContainerUnavailable"
  | "MethodNotAllowed"
  | "NotFound"
  | "RateLimited"
  | "RateLimitUnavailable"
  | "Unauthorized";

type AuthenticationResult =
  | { readonly status: "authenticated"; readonly rateLimitKey: string }
  | { readonly status: "open" }
  | { readonly status: "unauthorized" };

const errorResponse = (
  requestId: string,
  startedAtMs: number,
  message: string,
  type: WorkerErrorType,
  status: number
): Response =>
  Response.json(
    {
      error: { message, type },
      metadata: makeResponseMetadata(requestId, startedAtMs),
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

const sha256 = async (value: string): Promise<Uint8Array<ArrayBuffer>> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
};

const digestToHex = (digest: Uint8Array<ArrayBuffer>): string => {
  let hex = "";
  for (const byte of digest) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
};

const authenticate = async (
  request: Request,
  expectedToken: string
): Promise<AuthenticationResult> => {
  if (expectedToken.length === 0) {
    return { status: "open" };
  }

  const authorization = request.headers.get("authorization");
  if (authorization === null) {
    return { status: "unauthorized" };
  }

  const [scheme, suppliedToken, ...extraParts] = authorization.split(" ");
  if (
    scheme?.toLowerCase() !== "bearer" ||
    suppliedToken === undefined ||
    suppliedToken.length === 0 ||
    extraParts.length > 0
  ) {
    return { status: "unauthorized" };
  }

  const [expectedDigest, suppliedDigest] = await Promise.all([
    sha256(expectedToken),
    sha256(suppliedToken),
  ]);
  let difference = 0;
  for (const [index, expectedByte] of expectedDigest.entries()) {
    difference += Math.abs(expectedByte - (suppliedDigest[index] ?? 0));
  }

  if (difference !== 0) {
    return { status: "unauthorized" };
  }

  return {
    rateLimitKey: `token:${digestToHex(expectedDigest)}`,
    status: "authenticated",
  };
};

const prepareForwardRequest = (
  request: Request,
  requestId: string
): Request => {
  const forwardedRequest =
    request.headers.get("authorization") === null
      ? request
      : new Request(request);

  try {
    forwardedRequest.headers.delete("authorization");
    forwardedRequest.headers.set(INTERNAL_REQUEST_ID_HEADER, requestId);
    return forwardedRequest;
  } catch {
    const headers = new Headers(forwardedRequest.headers);
    headers.delete("authorization");
    headers.set(INTERNAL_REQUEST_ID_HEADER, requestId);
    return new Request(forwardedRequest, { headers });
  }
};

const clientRateLimitKey = (
  request: Request,
  authentication: AuthenticationResult
): string => {
  if (authentication.status === "authenticated") {
    return authentication.rateLimitKey;
  }

  return `ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
};

/**
 * Handles the public Worker route contract, applies Worker-side abuse
 * protection, and forwards accepted requests through the supplied Container
 * boundary.
 *
 * @param request - The incoming public Worker request.
 * @param forwardRequest - The concrete Container forwarding function.
 * @param protection - Worker authentication and query rate-limit bindings.
 * @param recordHttpCompletion - Optional safe structured completion recorder.
 * @returns The downstream response or a Worker-generated boundary error.
 */
export const handleWorkerRequest = async (
  request: Request,
  forwardRequest: ForwardRequest,
  protection: WorkerProtection,
  recordHttpCompletion?: RecordHttpCompletion
): Promise<Response> => {
  const requestId = readCloudflareRequestId(request) ?? createRequestId();
  const startedAt = Date.now();
  const { pathname } = new URL(request.url);

  const error = (message: string, type: WorkerErrorType, status: number) =>
    errorResponse(requestId, startedAt, message, type, status);

  const complete = (response: Response): Response => {
    const correlatedResponse = withRequestIdHeader(response, requestId);
    if (recordHttpCompletion !== undefined) {
      try {
        const completion = makeHttpCompletionMetadata(
          request,
          correlatedResponse,
          Date.now() - startedAt,
          requestId
        );
        const cloudflareRay = request.headers.get(CLOUDFLARE_RAY_HEADER);
        recordHttpCompletion(
          cloudflareRay === null ? completion : { ...completion, cloudflareRay }
        );
      } catch {
        // Observability is best-effort and must not change request outcomes.
      }
    }
    return correlatedResponse;
  };

  if (pathname !== "/health" && pathname !== "/query") {
    return complete(
      error("Supported routes: /health, /query", "NotFound", 404)
    );
  }

  if (!isAllowedMethod(request.method, pathname)) {
    return complete(error("Method not allowed", "MethodNotAllowed", 405));
  }

  if (pathname === "/query") {
    const authentication = await authenticate(request, protection.authToken);
    if (authentication.status === "unauthorized") {
      return complete(
        error("Missing or invalid bearer token", "Unauthorized", 401)
      );
    }

    if (protection.rateLimit === undefined) {
      return complete(
        error("Query rate limiting is unavailable", "RateLimitUnavailable", 503)
      );
    }

    try {
      const { success } = await protection.rateLimit.limit({
        key: clientRateLimitKey(request, authentication),
      });
      if (!success) {
        return complete(error("Query rate limit exceeded", "RateLimited", 429));
      }
    } catch {
      return complete(
        error("Query rate limiting is unavailable", "RateLimitUnavailable", 503)
      );
    }
  }

  try {
    return complete(
      await forwardRequest(prepareForwardRequest(request, requestId))
    );
  } catch {
    return complete(
      error(
        "GameDig service temporarily unavailable",
        "ContainerUnavailable",
        503
      )
    );
  }
};
