import { Data } from "effect3";

/** UDP endpoint details captured during an A2S query. */
export interface A2SDiagnostics {
  readonly host: string;
  readonly port: number;
  readonly startedAt: string;
  readonly socketCreatedAt?: string | undefined;
  readonly local?:
    | { readonly address: string; readonly port: number }
    | undefined;
  readonly packetSentAt?: string | undefined;
  readonly responseAt?: string | undefined;
  readonly remote?:
    | { readonly address: string; readonly port: number }
    | undefined;
  readonly responseBytes?: number | undefined;
  readonly elapsedMs: number;
}

interface A2SErrorFields {
  readonly message: string;
  readonly diagnostics: A2SDiagnostics;
}

/** Failure while creating the UDP socket. */
export class SocketCreationError extends Data.TaggedError(
  "SocketCreationError"
)<A2SErrorFields> {
  readonly stage = "socket" as const;
}

/** Failure while binding the UDP socket. */
export class SocketBindError extends Data.TaggedError(
  "SocketBindError"
)<A2SErrorFields> {
  readonly stage = "bind" as const;
}

/** Failure while sending an A2S datagram. */
export class SocketSendError extends Data.TaggedError(
  "SocketSendError"
)<A2SErrorFields> {
  readonly stage = "send" as const;
}

/** Failure while waiting for an A2S datagram. */
export class SocketReceiveError extends Data.TaggedError(
  "SocketReceiveError"
)<A2SErrorFields> {
  readonly stage = "receive" as const;
}

/** Failure when no UDP response arrives before the configured deadline. */
export class A2STimeoutError extends Data.TaggedError("A2STimeoutError")<
  A2SErrorFields & { readonly timeoutMs: number }
> {
  readonly stage = "receive" as const;
}

/** Failure when a UDP response is not a supported A2S_INFO packet. */
export class A2SProtocolError extends Data.TaggedError(
  "A2SProtocolError"
)<A2SErrorFields> {
  readonly stage = "protocol" as const;
}

/** All expected failures produced by the raw A2S service. */
export type A2SError =
  | SocketCreationError
  | SocketBindError
  | SocketSendError
  | SocketReceiveError
  | A2STimeoutError
  | A2SProtocolError;
