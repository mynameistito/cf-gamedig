import { createSocket } from "node:dgram";

export const QUAKE3_FIXTURE_PORT = 27_960;

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

export interface Quake3Fixture {
  readonly address: string;
  readonly close: () => Promise<void>;
  readonly exchangeCount: () => number;
  readonly port: number;
}

interface Quake3FixtureOptions {
  readonly host?: string;
  readonly onExchange?: (remoteAddress: string, remotePort: number) => void;
  readonly onUnexpectedPacket?: (packetHex: string) => void;
  readonly port?: number;
}

export const startQuake3Fixture = (
  options: Quake3FixtureOptions = {}
): Promise<Quake3Fixture> =>
  new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    let exchanges = 0;

    const startupError = (error: Error): void => {
      reject(error);
    };

    socket.once("error", startupError);
    socket.on("message", (message, remote) => {
      if (!packetEquals(message, EXPECTED_QUERY)) {
        options.onUnexpectedPacket?.(toHex(message));
        return;
      }

      exchanges += 1;
      socket.send(STATUS_RESPONSE, remote.port, remote.address);
      options.onExchange?.(remote.address, remote.port);
    });

    socket.bind(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      socket.off("error", startupError);
      const bound = socket.address();
      if (typeof bound === "string") {
        socket.close();
        reject(new TypeError(`Unexpected UDP socket address: ${bound}`));
        return;
      }

      resolve({
        address: bound.address,
        close: () =>
          new Promise<void>((resolveClose) => {
            socket.close(() => resolveClose());
          }),
        exchangeCount: () => exchanges,
        port: bound.port,
      });
    });
  });
