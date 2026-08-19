import { Buffer } from "node:buffer";
import dgram from "node:dgram";
import type { RemoteInfo, Socket } from "node:dgram";

import { Duration, Effect, Layer } from "effect3";

import {
  A2SProtocolError,
  A2STimeoutError,
  SocketBindError,
  SocketCreationError,
  SocketReceiveError,
  SocketSendError,
} from "./errors.ts";
import type { A2SDiagnostics, A2SError } from "./errors.ts";
import {
  A2S_INFO_REQUEST,
  parseA2SInfo,
  readA2SChallenge,
} from "./protocol.ts";
import { A2SService } from "./service.ts";
import type { A2SInfoResult } from "./service.ts";

interface DiagnosticState {
  readonly host: string;
  readonly port: number;
  readonly startedAtMs: number;
  socketCreatedAt?: string;
  local?: { readonly address: string; readonly port: number };
  packetSentAt?: string;
  responseAt?: string;
  remote?: { readonly address: string; readonly port: number };
  responseBytes?: number;
}

interface DatagramResponse {
  readonly packet: Buffer;
  readonly remote: RemoteInfo;
}

const snapshot = (state: DiagnosticState): A2SDiagnostics => ({
  elapsedMs: Date.now() - state.startedAtMs,
  host: state.host,
  local: state.local,
  packetSentAt: state.packetSentAt,
  port: state.port,
  remote: state.remote,
  responseAt: state.responseAt,
  responseBytes: state.responseBytes,
  socketCreatedAt: state.socketCreatedAt,
  startedAt: new Date(state.startedAtMs).toISOString(),
});

const closeSocket = (socket: Socket): Effect.Effect<void> =>
  Effect.sync(() => {
    try {
      socket.close();
    } catch {
      // An unbound dgram socket has no native handle to close.
    }
  });

const bindSocket = (
  socket: Socket,
  state: DiagnosticState
): Effect.Effect<void, SocketBindError> =>
  Effect.async<void, SocketBindError>((resume) => {
    const onError = (cause: Error): void => {
      socket.off("listening", onListening);
      resume(
        Effect.fail(
          new SocketBindError({
            diagnostics: snapshot(state),
            message: `Unable to bind UDP socket: ${cause.message}`,
          })
        )
      );
    };
    const onListening = (): void => {
      socket.off("error", onError);
      const address = socket.address();
      state.local = { address: address.address, port: address.port };
      resume(Effect.void);
    };
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind(0, "0.0.0.0");
    return Effect.sync(() => {
      socket.off("error", onError);
      socket.off("listening", onListening);
    });
  });

const sendAndReceive = (
  socket: Socket,
  packet: Buffer,
  state: DiagnosticState
): Effect.Effect<DatagramResponse, SocketSendError | SocketReceiveError> =>
  Effect.async<DatagramResponse, SocketSendError | SocketReceiveError>(
    (resume) => {
      let sendCompleted = false;
      const cleanup = (): void => {
        socket.off("error", onError);
        socket.off("message", onMessage);
      };
      const onError = (cause: Error): void => {
        cleanup();
        const ErrorType = sendCompleted ? SocketReceiveError : SocketSendError;
        resume(
          Effect.fail(
            new ErrorType({
              diagnostics: snapshot(state),
              message: `UDP socket error: ${cause.message}`,
            })
          )
        );
      };
      const onMessage = (response: Buffer, remote: RemoteInfo): void => {
        if (remote.port !== state.port) {
          return;
        }
        cleanup();
        state.responseAt = new Date().toISOString();
        state.remote = { address: remote.address, port: remote.port };
        state.responseBytes = response.length;
        resume(Effect.succeed({ packet: response, remote }));
      };

      socket.on("error", onError);
      socket.on("message", onMessage);
      socket.send(packet, state.port, state.host, (cause) => {
        if (cause) {
          cleanup();
          resume(
            Effect.fail(
              new SocketSendError({
                diagnostics: snapshot(state),
                message: `Unable to send UDP packet: ${cause.message}`,
              })
            )
          );
          return;
        }
        sendCompleted = true;
        state.packetSentAt = new Date().toISOString();
      });

      return Effect.sync(cleanup);
    }
  );

const queryInfo = (
  host: string,
  port: number,
  timeoutMs: number
): Effect.Effect<A2SInfoResult, A2SError> => {
  const state: DiagnosticState = { host, port, startedAtMs: Date.now() };
  return Effect.scoped(
    Effect.gen(function* runQueryInfo() {
      const socket = yield* Effect.acquireRelease(
        Effect.try({
          catch: (cause) =>
            new SocketCreationError({
              message:
                cause instanceof Error
                  ? `Unable to create UDP socket: ${cause.message}`
                  : "Unable to create UDP socket",
              diagnostics: snapshot(state),
            }),
          try: () => dgram.createSocket("udp4"),
        }),
        closeSocket
      );

      state.socketCreatedAt = new Date().toISOString();
      yield* Effect.logInfo("UDP socket created").pipe(
        Effect.annotateLogs({ host, port })
      );
      yield* bindSocket(socket, state);
      yield* Effect.logInfo("UDP socket bound").pipe(
        Effect.annotateLogs({
          destinationAddress: host,
          destinationPort: port,
          localAddress: state.local?.address,
          localPort: state.local?.port,
        })
      );

      const first = yield* sendAndReceive(socket, A2S_INFO_REQUEST, state);
      yield* Effect.logInfo("UDP packet send completed").pipe(
        Effect.annotateLogs({
          destinationAddress: host,
          destinationPort: port,
          packetSentAt: state.packetSentAt,
        })
      );
      const challenge = readA2SChallenge(first.packet);
      const finalResponse = challenge
        ? yield* sendAndReceive(
            socket,
            Buffer.concat([A2S_INFO_REQUEST, challenge]),
            state
          )
        : first;
      yield* Effect.logInfo("A2S_INFO response received").pipe(
        Effect.annotateLogs({
          destinationAddress: host,
          destinationPort: port,
          elapsedMs: Date.now() - state.startedAtMs,
          localAddress: state.local?.address,
          localPort: state.local?.port,
          packetSentAt: state.packetSentAt,
          remoteAddress: finalResponse.remote.address,
          remotePort: finalResponse.remote.port,
          responseAt: state.responseAt,
          responseBytes: finalResponse.packet.length,
        })
      );
      const diagnostics = snapshot(state);
      const info = yield* parseA2SInfo(finalResponse.packet, diagnostics);

      if (
        !(
          state.local &&
          state.socketCreatedAt &&
          state.packetSentAt &&
          state.responseAt &&
          state.remote
        )
      ) {
        return yield* new A2SProtocolError({
          diagnostics,
          message:
            "A2S diagnostics were incomplete after a successful response",
        });
      }

      return {
        elapsedMs: diagnostics.elapsedMs,
        host,
        local: state.local,
        packetType: "A2S_INFO",
        port,
        remote: state.remote,
        responseBytes: finalResponse.packet.length,
        server: info,
        success: true,
        timestamps: {
          packetSent: state.packetSentAt,
          responseReceived: state.responseAt,
          socketCreated: state.socketCreatedAt,
        },
        transport: "udp",
      } satisfies A2SInfoResult;
    }).pipe(
      Effect.timeoutFail({
        duration: Duration.millis(timeoutMs),
        onTimeout: () =>
          new A2STimeoutError({
            diagnostics: {
              ...snapshot(state),
              elapsedMs: Date.now() - state.startedAtMs,
            },
            message: `No UDP response received within ${timeoutMs} milliseconds`,
            timeoutMs,
          }),
      }),
      Effect.tapError((error) =>
        Effect.logError("Raw A2S query failed").pipe(
          Effect.annotateLogs({
            elapsedMs: error.diagnostics.elapsedMs,
            host,
            port,
            stage: error.stage,
            type: error._tag,
          })
        )
      )
    )
  );
};

/** Live Node/Bun dgram implementation of the raw A2S service. */
export const A2SServiceLive = Layer.succeed(A2SService, { queryInfo });
