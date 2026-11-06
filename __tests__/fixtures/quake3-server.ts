export const QUAKE3_FIXTURE_PORT = 27_960;

const encodeLatin1 = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.codePointAt(0) ?? 0);

const EXPECTED_QUERY = encodeLatin1("\u00FF\u00FF\u00FF\u00FFgetstatus\u0000");

const SERVER_INFO = [
  "\\sv_hostname\\^1CF GameDig E2E",
  "\\mapname\\q3dm17",
  "\\sv_maxclients\\16",
  "\\clients\\2",
  "\\g_needpass\\0",
  "\\version\\ioquake3 1.36",
].join("");

const STATUS_RESPONSE = encodeLatin1(
  [
    "\u00FF\u00FF\u00FF\u00FFstatusResponse",
    SERVER_INFO,
    '7 42 "^2Alice"',
    '0 0 "^3Fixture Bot"',
    "",
  ].join("\n")
);

const packetEquals = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Running UDP fixture and its lifecycle controls.
 */
export interface Quake3Fixture {
  readonly address: string;
  readonly close: () => void;
  readonly exchangeCount: () => number;
  readonly port: number;
}

interface Quake3FixtureOptions {
  readonly host?: string;
  readonly onExchange?: (remoteAddress: string, remotePort: number) => void;
  readonly onUnexpectedPacket?: (packetHex: string) => void;
  readonly port?: number;
}

/**
 * Start a local Quake 3 UDP server fixture.
 * @param options - Bind address and packet callbacks.
 * @returns The running fixture and its controls.
 */
export const startQuake3Fixture = async (
  options: Quake3FixtureOptions = {}
): Promise<Quake3Fixture> => {
  let exchanges = 0;
  const address = options.host ?? "127.0.0.1";

  const socket = await Bun.udpSocket({
    hostname: address,
    port: options.port ?? 0,
    socket: {
      data(server, message, remotePort, remoteAddress) {
        if (!packetEquals(message, EXPECTED_QUERY)) {
          options.onUnexpectedPacket?.(toHex(message));

          return;
        }

        exchanges += 1;
        server.send(STATUS_RESPONSE, remotePort, remoteAddress);
        options.onExchange?.(remoteAddress, remotePort);
      },
    },
  });

  return {
    address,
    close: () => {
      socket.close();
    },
    exchangeCount: () => exchanges,
    port: socket.port,
  };
};
