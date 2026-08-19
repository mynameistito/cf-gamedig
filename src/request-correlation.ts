export const INTERNAL_REQUEST_ID_HEADER =
  "x-cf-gamedig-internal-request-id";
export const REQUEST_ID_HEADER = "x-cf-gamedig-request-id";

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type HttpCompletionMetadata = {
  readonly elapsedMs: number;
  readonly method: string;
  readonly requestId?: string;
  readonly route: string;
  readonly status: number;
};

export const createRequestId = (): string => crypto.randomUUID();

export const readInternalRequestId = (request: Request): string | undefined => {
  const value = request.headers.get(INTERNAL_REQUEST_ID_HEADER);
  if (value === null || value.length !== 36 || !REQUEST_ID_PATTERN.test(value)) {
    return undefined;
  }
  return value;
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
