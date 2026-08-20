import { createSocket } from "node:dgram";

const FIXTURE_PORT = 27_960;
const EXPECTED_QUERY = Buffer.from(
  "\u00FF\u00FF\u00FF\u00FFgetstatus\u0000",
  "latin1"
);
const SERVER_INFO = [
  "\\sv_hostname\\^1CF GameDig E2E",
  "\\mapname\\q3dm17",
  "\\sv_maxclients\\16",
  "\\clients\\2",
  "\\g_needpass\\0",
  "\\version\\ioquake3 1.36",
].join("");
const STATUS_RESPONSE = Buffer.from(
  [
    "\u00FF\u00FF\u00FF\u00FFstatusResponse",
    SERVER_INFO,
    '7 42 "^2Alice"',
    '0 0 "^3Fixture Bot"',
    "",
  ].join("\n"),
  "latin1"
);

const packetEquals = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const socket = createSocket("udp4");

socket.on("message", (message, remote) => {
  if (!packetEquals(message, EXPECTED_QUERY)) {
    console.error(
      JSON.stringify({
        event: "quake3_fixture_unexpected_packet",
        packetHex: toHex(message),
        remoteAddress: remote.address,
        remotePort: remote.port,
      })
    );
    return;
  }

  socket.send(STATUS_RESPONSE, remote.port, remote.address);
  console.info(
    JSON.stringify({
      event: "quake3_fixture_exchange",
      remoteAddress: remote.address,
      remotePort: remote.port,
    })
  );
});

socket.on("error", (error) => {
  console.error(
    JSON.stringify({
      error: error.message,
      event: "quake3_fixture_socket_error",
    })
  );
  process.exitCode = 1;
});

socket.bind(FIXTURE_PORT, "0.0.0.0", () => {
  console.info(
    JSON.stringify({
      event: "quake3_fixture_ready",
      port: FIXTURE_PORT,
      protocol: "quake3",
      transport: "udp",
    })
  );
});

const shutdown = (): void => {
  socket.close();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
