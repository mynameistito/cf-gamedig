# Operations and troubleshooting

## Request correlation

Every request that enters the public Worker is assigned a new cryptographically random UUID by the Worker. Caller-supplied request IDs are not authoritative and cannot replace this value.

The Worker forwards the trusted ID to the Container with the internal `x-cf-gamedig-internal-request-id` header. Public responses expose the same value as:

```text
x-cf-gamedig-request-id: <uuid>
```

When reporting a failed request, include that response header value. Worker-generated errors, Container validation errors, and GameDig failures all retain the same correlation ID when the request reached the public Worker.

## Logging

Cloudflare observability remains the logging backend; no external observability service is required.

The Worker emits a `worker_http_completed` structured event containing only safe HTTP completion metadata:

- request ID;
- method;
- route pathname;
- status;
- elapsed milliseconds.

The Container emits `Container HTTP request completed` through Effect with an `event=container_http_completed` annotation and the same safe metadata. The request ID is also installed as an Effect log annotation around the GameDig operation, so the existing `GameDig query started` and `GameDig query completed` logs can be joined to the same request.

Request query strings and raw POST bodies are not included in HTTP completion metadata. Logging context intentionally excludes `Authorization`, `password`, `apiKey`, `token`, and `telnetPassword` values.

## Container lifecycle events

The Worker-side `GameDigContainer` class uses the lifecycle hooks provided by the pinned `@cloudflare/containers` version and emits these structured events:

- `container_lifecycle_started` from `onStart()`;
- `container_lifecycle_stopped` from `onStop()`, with the safe exit code and stop reason;
- `container_lifecycle_error` from `onError()` without serializing the exception.

The error hook rethrows the original error after recording the safe event, preserving the package's failure behavior. The default activity-expiry handling is not overridden, so the existing `sleepAfter = "1m"` behavior is unchanged. Scaling, instance selection, and Container networking are also unchanged.
