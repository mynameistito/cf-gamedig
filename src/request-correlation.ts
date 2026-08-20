export const INTERNAL_REQUEST_ID_HEADER = "x-cf-gamedig-internal-request-id";
export const REQUEST_ID_HEADER = "x-cf-gamedig-request-id";
export const CLOUDFLARE_REQUEST_ID_HEADER = "cf-request-id";
export const CLOUDFLARE_RAY_HEADER = "cf-ray";

const MAX_CORRELATION_ID_LENGTH = 64;

const UUIDV4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UUIDV7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMPACT_UUID_PATTERN = /^[0-9a-f]{32}$/iu;
const RAY_ID_PATTERN = /^[0-9a-f]{16}(?:-[A-Za-z0-9]{3})?$/iu;

const CORRELATION_ID_PATTERN = new RegExp(
  [
    UUIDV4_PATTERN.source,
    UUIDV7_PATTERN.source,
    COMPACT_UUID_PATTERN.source,
    RAY_ID_PATTERN.source,
  ]
    .map((source) => `(?:${source})`)
    .join("|"),
  "iu"
);

const isValidCorrelationId = (value: string): boolean =>
  value.length <= MAX_CORRELATION_ID_LENGTH &&
  CORRELATION_ID_PATTERN.test(value);

export interface HttpCompletionMetadata {
  readonly cloudflareRay?: string;
  readonly elapsedMs: number;
  readonly method: string;
  readonly requestId?: string;
  readonly route: string;
  readonly status: number;
}

export interface ApiResponseMetadata {
  readonly elapsedMs: number;
  readonly requestId: string;
  readonly timestamp: string;
}

export const createRequestId = (): string => crypto.randomUUID();

export const makeResponseMetadata = (
  requestId: string,
  startedAtMs: number
): ApiResponseMetadata => {
  const now = Date.now();
  return {
    elapsedMs: Math.max(0, Math.trunc(now - startedAtMs)),
    requestId,
    timestamp: new Date(now).toISOString(),
  };
};

export const readInternalRequestId = (request: Request): string | undefined => {
  const value = request.headers.get(INTERNAL_REQUEST_ID_HEADER);
  return value !== null && isValidCorrelationId(value) ? value : undefined;
};

export const readCloudflareRequestId = (
  request: Request
): string | undefined => {
  const requestId = request.headers.get(CLOUDFLARE_REQUEST_ID_HEADER);
  if (requestId !== null && isValidCorrelationId(requestId)) {
    return requestId;
  }
  const ray = request.headers.get(CLOUDFLARE_RAY_HEADER);
  return ray !== null && isValidCorrelationId(ray) ? ray : undefined;
};

export const withRequestIdHeader = (
  response: Response,
  requestId: string
): Response => {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(REQUEST_ID_HEADER, requestId);
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
};

export const makeHttpCompletionMetadata = (
  request: Request,
  response: Response,
  elapsedMs: number,
  requestId?: string
): HttpCompletionMetadata => {
  const base = {
    elapsedMs: Math.max(0, Math.trunc(elapsedMs)),
    method: request.method,
    route: new URL(request.url).pathname,
    status: response.status,
  };

  return requestId === undefined ? base : { ...base, requestId };
};
