import { disposeRuntime, handleRequest } from "./server.ts";

const port = Math.trunc(Number(process.env.PORT ?? "8080"));

const server = Bun.serve({
  fetch: handleRequest,
  hostname: "0.0.0.0",
  port,
});

console.info(
  JSON.stringify({
    event: "container_http_listening",
    hostname: server.hostname,
    port: server.port,
  })
);

const shutdown = async (): Promise<void> => {
  await disposeRuntime();
  await server.stop();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
