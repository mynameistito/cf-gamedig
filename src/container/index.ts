import { disposeRuntime, handleRequest } from "./server.ts";

const listenPort = Math.trunc(Number(process.env.PORT ?? "8080"));

const httpServer = Bun.serve({
  fetch: handleRequest,
  hostname: "0.0.0.0",
  port: listenPort,
});

console.info(
  JSON.stringify({
    event: "container_http_listening",
    hostname: httpServer.hostname,
    port: httpServer.port,
  })
);

const shutdown = async (): Promise<void> => {
  await disposeRuntime();
  await httpServer.stop();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
