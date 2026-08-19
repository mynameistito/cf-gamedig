import { Buffer } from "node:buffer";

import { Effect } from "effect3";

import type { A2SInfo } from "../../shared/schema.ts";
import type { A2SDiagnostics } from "./errors.ts";
import { A2SProtocolError } from "./errors.ts";

/** Canonical Valve A2S_INFO request packet. */
export const A2S_INFO_REQUEST = Buffer.concat([
  Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
  Buffer.from("Source Engine Query\0", "ascii"),
]);

const readString = (
  packet: Buffer,
  offset: number
): readonly [string, number] => {
  const end = packet.indexOf(0, offset);
  if (end === -1) {
    throw new Error("A2S response contains an unterminated string");
  }
  return [new TextDecoder().decode(packet.subarray(offset, end)), end + 1];
};

const view = (packet: Buffer): DataView =>
  new DataView(packet.buffer, packet.byteOffset, packet.byteLength);

/** Return the challenge token from an A2S challenge response, if present. */
export const readA2SChallenge = (packet: Buffer): Buffer | undefined => {
  if (
    packet.length === 9 &&
    view(packet).getInt32(0, true) === -1 &&
    view(packet).getUint8(4) === 0x41
  ) {
    return packet.subarray(5, 9);
  }
  return undefined;
};

/** Parse the transport-relevant subset of an A2S_INFO response. */
export const parseA2SInfo = (
  packet: Buffer,
  diagnostics: A2SDiagnostics
): Effect.Effect<A2SInfo, A2SProtocolError> =>
  Effect.try({
    catch: (cause) =>
      new A2SProtocolError({
        message:
          cause instanceof Error ? cause.message : "Invalid A2S_INFO response",
        diagnostics,
      }),
    try: () => {
      if (
        packet.length < 6 ||
        view(packet).getInt32(0, true) !== -1 ||
        view(packet).getUint8(4) !== 0x49
      ) {
        throw new Error(
          "UDP response is not a single-packet A2S_INFO response"
        );
      }

      const data = view(packet);
      let offset = 5;
      const protocol = data.getUint8(offset);
      offset += 1;
      const [name, nameEnd] = readString(packet, offset);
      const [map, mapEnd] = readString(packet, nameEnd);
      const [folder, folderEnd] = readString(packet, mapEnd);
      const [game, gameEnd] = readString(packet, folderEnd);
      offset = gameEnd;

      const appId = data.getUint16(offset, true);
      offset += 2;
      const players = data.getUint8(offset);
      offset += 1;
      const maxPlayers = data.getUint8(offset);
      offset += 1;
      const bots = data.getUint8(offset);
      offset += 1;
      const serverType = String.fromCodePoint(data.getUint8(offset));
      offset += 1;
      const environment = String.fromCodePoint(data.getUint8(offset));
      offset += 1;
      const visibility = data.getUint8(offset);
      offset += 1;
      const vac = data.getUint8(offset);
      offset += 1;
      const [version] = readString(packet, offset);

      return {
        protocol,
        name,
        map,
        folder,
        game,
        appId,
        players,
        maxPlayers,
        bots,
        serverType,
        environment,
        visibility,
        vac,
        version,
      };
    },
  });
