type ForwardRequest = (request: Request) => Response | Promise<Response>;

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

const withoutAuthorization = (request: Request): Request => {
  if (!request.headers.has("authorization")) {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.delete("authorization");
  return new Request(request, { headers });
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
 * @returns The downstream response or a Worker-generated boundary error.
 */
export const handleWorkerRequest = async (
  request: Request,
  forwardRequest: ForwardRequest,
  protection: WorkerProtection
): Promise<Response> => {
  const { pathname } = new URL(request.url);

  if (pathname !== "/health" && pathname !== "/query") {
    return errorResponse("Supported routes: /health, /query", "NotFound", 404);
  }

  if (!isAllowedMethod(request.method, pathname)) {
    return errorResponse("Method not allowed", "MethodNotAllowed", 405);
  }

  if (pathname === "/query") {
    const authentication = await authenticate(request, protection.authToken);
    if (authentication.status === "unauthorized") {
      return errorResponse(
        "Missing or invalid bearer token",
        "Unauthorized",
        401
      );
    }

    if (protection.rateLimit === undefined) {
      return errorResponse(
        "Query rate limiting is unavailable",
        "RateLimitUnavailable",
        503
      );
    }

    try {
      const { success } = await protection.rateLimit.limit({
        key: clientRateLimitKey(request, authentication),
      });
      if (!success) {
        return errorResponse("Query rate limit exceeded", "RateLimited", 429);
      }
    } catch {
      return errorResponse(
        "Query rate limiting is unavailable",
        "RateLimitUnavailable",
        503
      );
    }
  }

  try {
    return await forwardRequest(withoutAuthorization(request));
  } catch {
    return errorResponse(
      "GameDig service temporarily unavailable",
      "ContainerUnavailable",
      503
    );
  }
};
