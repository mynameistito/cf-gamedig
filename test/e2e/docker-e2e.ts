import { execFile } from "node:child_process";

const APP_IMAGE = "cf-gamedig-e2e-app:local";
const FIXTURE_IMAGE = "cf-gamedig-e2e-fixture:local";
const FIXTURE_PORT = 27_960;
const DOCKER_COMMAND_TIMEOUT_MS = 120_000;
const STARTUP_TIMEOUT_MS = 15_000;
const HTTP_TIMEOUT_MS = 10_000;
const resourceSuffix = `${process.pid}-${Date.now()}`;
const networkName = `cf-gamedig-e2e-${resourceSuffix}`;
const fixtureContainerName = `cf-gamedig-e2e-fixture-${resourceSuffix}`;
const appContainerName = `cf-gamedig-e2e-app-${resourceSuffix}`;

interface CommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

const errorText = (cause: unknown): string =>
  cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);

const runCommand = (
  command: string,
  args: readonly string[],
  timeoutMs = DOCKER_COMMAND_TIMEOUT_MS
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const result = {
          stderr: String(stderr),
          stdout: String(stdout),
        };
        if (error !== null) {
          reject(
            new Error(
              [
                `Command failed: ${command} ${args.join(" ")}`,
                result.stdout.trim(),
                result.stderr.trim(),
              ]
                .filter((line) => line.length > 0)
                .join("\n"),
              { cause: error }
            )
          );
          return;
        }
        resolve(result);
      }
    );
  });

const runDocker = (
  args: readonly string[],
  timeoutMs = DOCKER_COMMAND_TIMEOUT_MS
): Promise<CommandResult> => runCommand("docker", args, timeoutMs);

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const expectRecord = (
  value: unknown,
  label: string
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const expectArray = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
};

const expectEqual = (
  actual: unknown,
  expected: string | number | boolean,
  label: string
): void => {
  if (actual !== expected) {
    const expectedText = JSON.stringify(expected);
    const actualText = JSON.stringify(actual);
    throw new Error(
      `${label} mismatch: expected ${expectedText}, received ${actualText}`
    );
  }
};

const parseJson = (text: string, label: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`${label} returned invalid JSON: ${text}`, { cause });
  }
};

const readContainerLogs = async (containerName: string): Promise<string> => {
  const result = await runDocker(["logs", containerName], 10_000);
  return [result.stdout, result.stderr]
    .filter((part) => part.length > 0)
    .join("\n");
};

const waitForContainerLog = async (
  containerName: string,
  event: string
): Promise<string> => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let latestLogs = "";
  while (Date.now() < deadline) {
    latestLogs = await readContainerLogs(containerName);
    if (latestLogs.includes(`"event":"${event}"`)) {
      return latestLogs;
    }
    await sleep(150);
  }
  throw new Error(
    `Timed out waiting for ${event} from ${containerName}\n${latestLogs}`
  );
};

const waitForHealth = async (baseUrl: string): Promise<void> => {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastFailure = "container did not respond";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      const text = await response.text();
      if (response.status === 200) {
        const body = expectRecord(parseJson(text, "GET /health"), "health body");
        expectEqual(body.success, true, "health success");
        expectEqual(
          body.service,
          "cf-gamedig-container",
          "health service name"
        );
        return;
      }
      lastFailure = `HTTP ${response.status}: ${text}`;
    } catch (cause) {
      lastFailure = errorText(cause);
    }
    await sleep(150);
  }
  throw new Error(`Container health check timed out: ${lastFailure}`);
};

const inspectFixtureAddress = async (): Promise<string> => {
  const { stdout } = await runDocker([
    "inspect",
    "--format",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    fixtureContainerName,
  ]);
  const address = stdout.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(address)) {
    throw new Error(
      `Unable to determine fixture container IPv4 address: ${address}`
    );
  }
  return address;
};

const inspectAppPort = async (): Promise<number> => {
  const { stdout } = await runDocker([
    "port",
    appContainerName,
    "8080/tcp",
  ]);
  const match = /127\.0\.0\.1:(\d+)/u.exec(stdout);
  const port = Number(match?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
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

  const body = expectRecord(parseJson(text, "GET /query"), "query body");
  expectEqual(body.success, true, "query success");

  const query = expectRecord(body.query, "query echo");
  expectEqual(query.address, fixtureAddress, "query address");
  expectEqual(query.givenPortOnly, true, "query givenPortOnly");
  expectEqual(query.host, "fixture.invalid", "query host");
  expectEqual(query.port, FIXTURE_PORT, "query port");
  expectEqual(query.type, "protocol-quake3", "query type");

  const server = expectRecord(body.server, "server result");
  expectEqual(
    server.connect,
    `fixture.invalid:${FIXTURE_PORT}`,
    "server connect"
  );
  expectEqual(server.map, "q3dm17", "server map");
  expectEqual(server.maxplayers, 16, "server maxplayers");
  expectEqual(server.name, "CF GameDig E2E", "server name");
  expectEqual(server.numplayers, 2, "server numplayers");
  expectEqual(server.password, false, "server password");
  expectEqual(server.queryPort, FIXTURE_PORT, "server queryPort");
  expectEqual(server.version, "ioquake3 1.36", "server version");

  const players = expectArray(server.players, "server players");
  expectEqual(
    expectRecord(players[0], "first player").name,
    "Alice",
    "first player name"
  );

  const bots = expectArray(server.bots, "server bots");
  expectEqual(
    expectRecord(bots[0], "first bot").name,
    "Fixture Bot",
    "first bot name"
  );

  expectRecord(server.raw, "server raw");
  if (typeof server.ping !== "number" || server.ping < 0) {
    throw new Error(`server ping must be a non-negative number: ${server.ping}`);
  }
};

const cleanupResource = async (args: readonly string[]): Promise<void> => {
  try {
    await runDocker(args, 30_000);
  } catch {
    // Best-effort cleanup: a previous command may have failed before creation.
  }
};

const printDiagnostics = async (): Promise<void> => {
  for (const containerName of [appContainerName, fixtureContainerName]) {
    try {
      const logs = await readContainerLogs(containerName);
      console.error(`--- ${containerName} logs ---\n${logs || "(no logs)"}`);
    } catch (cause) {
      console.error(
        `--- unable to read ${containerName} logs ---\n${errorText(cause)}`
      );
    }
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
    await waitForContainerLog(
      fixtureContainerName,
      "quake3_fixture_exchange"
    );

    console.info(
      "Docker E2E passed: production Container completed a real Quake 3 UDP query"
    );
  } catch (cause) {
    await printDiagnostics();
    throw cause;
  } finally {
    await cleanupResource(["rm", "--force", appContainerName]);
    await cleanupResource(["rm", "--force", fixtureContainerName]);
    await cleanupResource(["network", "rm", networkName]);
  }
};

await run();
