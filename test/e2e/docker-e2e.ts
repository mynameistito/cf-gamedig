import { strict as assert } from "node:assert";

import { Result, Schema } from "effect";

import { GameDigResultSchema } from "../../src/container/gamedig/schema.ts";

const APP_IMAGE = "cf-gamedig-e2e-app:local";
const FIXTURE_IMAGE = "cf-gamedig-e2e-fixture:local";
const FIXTURE_PORT = 27_960;
const DOCKER_COMMAND_TIMEOUT_MS = 120_000;
const STARTUP_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 150;
const resourceSuffix = `${process.pid}-${Date.now()}`;
const networkName = `cf-gamedig-e2e-${resourceSuffix}`;
const fixtureContainerName = `cf-gamedig-e2e-fixture-${resourceSuffix}`;
const appContainerName = `cf-gamedig-e2e-app-${resourceSuffix}`;

const HealthResponseSchema = Schema.Struct({
  service: Schema.String,
  success: Schema.Boolean,
});
type HealthResponse = typeof HealthResponseSchema.Type;

const QueryEchoSchema = Schema.Struct({
  address: Schema.String,
  givenPortOnly: Schema.Boolean,
  host: Schema.String,
  port: Schema.Number,
  type: Schema.String,
});
const QueryResponseSchema = Schema.Struct({
  query: QueryEchoSchema,
  server: GameDigResultSchema,
  success: Schema.Boolean,
});
type QueryResponse = typeof QueryResponseSchema.Type;

interface CommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

const runCommand = async (
  command: string,
  args: readonly string[],
  timeoutMs = DOCKER_COMMAND_TIMEOUT_MS
): Promise<CommandResult> => {
  const subprocess = Bun.spawn([command, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    subprocess.kill();
  }, timeoutMs);

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      subprocess.exited,
      Bun.readableStreamToText(subprocess.stdout),
      Bun.readableStreamToText(subprocess.stderr),
    ]);

    if (exitCode !== 0) {
      const failure = timedOut
        ? `Command timed out after ${timeoutMs}ms`
        : `Command exited with code ${exitCode}`;
      throw new Error(
        [
          `${failure}: ${command} ${args.join(" ")}`,
          stdout.trim(),
          stderr.trim(),
        ]
          .filter((line) => line.length > 0)
          .join("\n")
      );
    }

    return { stderr, stdout };
  } finally {
    clearTimeout(timeout);
  }
};

const runDocker = (
  args: readonly string[],
  timeoutMs = DOCKER_COMMAND_TIMEOUT_MS
): Promise<CommandResult> => runCommand("docker", args, timeoutMs);

const parseHealthResponse = (text: string): HealthResponse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`GET /health returned invalid JSON: ${text}`, {
      cause: error,
    });
  }

  const decoded = Schema.decodeUnknownResult(HealthResponseSchema)(parsed);
  if (Result.isFailure(decoded)) {
    throw new TypeError(`GET /health returned an invalid response: ${text}`);
  }
  return decoded.success;
};

const parseQueryResponse = (text: string): QueryResponse => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TypeError(`GET /query returned invalid JSON: ${text}`, {
      cause: error,
    });
  }

  const decoded = Schema.decodeUnknownResult(QueryResponseSchema)(parsed);
  if (Result.isFailure(decoded)) {
    throw new TypeError(`GET /query returned an invalid response: ${text}`);
  }
  return decoded.success;
};

const readContainerLogs = async (containerName: string): Promise<string> => {
  const result = await runDocker(["logs", containerName], 10_000);
  return [result.stdout, result.stderr]
    .filter((part) => part.length > 0)
    .join("\n");
};

const waitForContainerLogUntil = async (
  containerName: string,
  event: string,
  deadline: number
): Promise<string> => {
  const logs = await readContainerLogs(containerName);
  if (logs.includes(`"event":"${event}"`)) {
    return logs;
  }
  if (Date.now() >= deadline) {
    throw new Error(
      `Timed out waiting for ${event} from ${containerName}\n${logs}`
    );
  }

  await Bun.sleep(POLL_INTERVAL_MS);
  return waitForContainerLogUntil(containerName, event, deadline);
};

const waitForContainerLog = (
  containerName: string,
  event: string
): Promise<string> =>
  waitForContainerLogUntil(
    containerName,
    event,
    Date.now() + STARTUP_TIMEOUT_MS
  );

const waitForHealthUntil = async (
  baseUrl: string,
  deadline: number,
  previousFailure: string
): Promise<void> => {
  let failure = previousFailure;
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const text = await response.text();
    if (response.status === 200) {
      const body = parseHealthResponse(text);
      assert.equal(body.success, true, "health success");
      assert.equal(body.service, "cf-gamedig-container", "health service name");
      return;
    }
    failure = `HTTP ${response.status}: ${text}`;
  } catch (error) {
    failure = String(error);
  }

  if (Date.now() >= deadline) {
    throw new Error(`Container health check timed out: ${failure}`);
  }

  await Bun.sleep(POLL_INTERVAL_MS);
  return waitForHealthUntil(baseUrl, deadline, failure);
};

const waitForHealth = (baseUrl: string): Promise<void> =>
  waitForHealthUntil(
    baseUrl,
    Date.now() + STARTUP_TIMEOUT_MS,
    "container did not respond"
  );

const inspectFixtureAddress = async (): Promise<string> => {
  const { stdout } = await runDocker([
    "inspect",
    "--format",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    fixtureContainerName,
  ]);
  const address = stdout.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(address)) {
    throw new TypeError(
      `Unable to determine fixture container IPv4 address: ${address}`
    );
  }
  return address;
};

const inspectAppPort = async (): Promise<number> => {
  const { stdout } = await runDocker(["port", appContainerName, "8080/tcp"]);
  const match = /127\.0\.0\.1:(?<port>\d+)/u.exec(stdout);
  const port = Number(match?.groups?.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError(
      `Unable to determine mapped Container HTTP port: ${stdout}`
    );
  }
  return port;
};

const queryGameServer = async (
  baseUrl: string,
  fixtureAddress: string
): Promise<void> => {
  const url = new URL("/query", baseUrl);
  url.search = new URLSearchParams({
    address: fixtureAddress,
    attemptTimeout: "3000",
    givenPortOnly: "true",
    host: "fixture.invalid",
    ipFamily: "4",
    maxRetries: "1",
    port: String(FIXTURE_PORT),
    socketTimeout: "1000",
    type: "protocol-quake3",
  }).toString();

  const response = await fetch(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`GET /query failed with HTTP ${response.status}: ${text}`);
  }

  const body = parseQueryResponse(text);
  assert.equal(body.success, true, "query success");
  assert.equal(body.query.address, fixtureAddress, "query address");
  assert.equal(body.query.givenPortOnly, true, "query givenPortOnly");
  assert.equal(body.query.host, "fixture.invalid", "query host");
  assert.equal(body.query.port, FIXTURE_PORT, "query port");
  assert.equal(body.query.type, "protocol-quake3", "query type");

  assert.equal(
    body.server.connect,
    `fixture.invalid:${FIXTURE_PORT}`,
    "server connect"
  );
  assert.equal(body.server.map, "q3dm17", "server map");
  assert.equal(body.server.maxplayers, 16, "server maxplayers");
  assert.equal(body.server.name, "CF GameDig E2E", "server name");
  assert.equal(body.server.numplayers, 2, "server numplayers");
  assert.equal(body.server.password, false, "server password");
  assert.equal(body.server.queryPort, FIXTURE_PORT, "server queryPort");
  assert.equal(body.server.version, "ioquake3 1.36", "server version");
  assert.equal(body.server.players.length, 1, "server player count");
  assert.equal(body.server.players[0]?.name, "Alice", "first player name");
  assert.equal(body.server.bots.length, 1, "server bot count");
  assert.equal(body.server.bots[0]?.name, "Fixture Bot", "first bot name");
  assert.ok(body.server.ping >= 0, "server ping must be non-negative");
};

const cleanupResource = async (args: readonly string[]): Promise<void> => {
  try {
    await runDocker(args, 30_000);
  } catch {
    // Best-effort cleanup: a previous command may have failed before creation.
  }
};

const readDiagnostic = async (containerName: string): Promise<string> => {
  try {
    const logs = await readContainerLogs(containerName);
    return `--- ${containerName} logs ---\n${logs || "(no logs)"}`;
  } catch (error) {
    return `--- unable to read ${containerName} logs ---\n${String(error)}`;
  }
};

const printDiagnostics = async (): Promise<void> => {
  const diagnostics = await Promise.all(
    [appContainerName, fixtureContainerName].map(readDiagnostic)
  );
  for (const diagnostic of diagnostics) {
    console.error(diagnostic);
  }
};

const run = async (): Promise<void> => {
  try {
    console.info("Building production Docker image");
    await runDocker(["build", "--tag", APP_IMAGE, "."]);

    console.info("Building deterministic Quake 3 UDP fixture image");
    await runDocker([
      "build",
      "--file",
      "test/e2e/Dockerfile",
      "--tag",
      FIXTURE_IMAGE,
      "test/e2e",
    ]);

    await runDocker(["network", "create", networkName]);

    await runDocker([
      "run",
      "--detach",
      "--name",
      fixtureContainerName,
      "--network",
      networkName,
      FIXTURE_IMAGE,
    ]);
    await waitForContainerLog(fixtureContainerName, "quake3_fixture_ready");
    const fixtureAddress = await inspectFixtureAddress();

    await runDocker([
      "run",
      "--detach",
      "--name",
      appContainerName,
      "--network",
      networkName,
      "--publish",
      "127.0.0.1::8080",
      APP_IMAGE,
    ]);

    const appPort = await inspectAppPort();
    const baseUrl = `http://127.0.0.1:${appPort}`;
    await waitForHealth(baseUrl);
    await queryGameServer(baseUrl, fixtureAddress);
    await waitForContainerLog(fixtureContainerName, "quake3_fixture_exchange");

    console.info(
      "Docker E2E passed: production Container completed a real Quake 3 UDP query"
    );
  } catch (error) {
    await printDiagnostics();
    throw error;
  } finally {
    await cleanupResource(["rm", "--force", appContainerName]);
    await cleanupResource(["rm", "--force", fixtureContainerName]);
    await cleanupResource(["network", "rm", networkName]);
  }
};

await run();
