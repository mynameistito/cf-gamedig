import { Result } from "effect";

import { disposeRuntime, makeContainerRequestHandler } from "./server.ts";
import { parseTargetPolicyMode, TARGET_POLICY_ENV } from "./target-policy.ts";

const listenPort = Math.trunc(Number(process.env.PORT ?? "8080"));
const targetPolicy = parseTargetPolicyMode(process.env[TARGET_POLICY_ENV]);

if (Result.isFailure(targetPolicy)) {
  console.error(
    JSON.stringify({
      event: "container_configuration_error",
      message: targetPolicy.failure.message,
    })
  );
  process.exit(1);
}

const httpServer = Bun.serve({
  fetch: makeContainerRequestHandler(targetPolicy.success),
  hostname: "0.0.0.0",
  port: listenPort,
});

console.info(
  JSON.stringify({
    event: "container_http_listening",
    hostname: httpServer.hostname,
    port: httpServer.port,
    targetPolicy: targetPolicy.success,
  })
);

const shutdown = async (): Promise<void> => {
  await disposeRuntime();
  await httpServer.stop();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
