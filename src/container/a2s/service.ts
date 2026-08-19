import { Context } from "effect3";
import type { Effect } from "effect3";

import type { A2SInfo } from "../../shared/schema.ts";
import type { A2SError } from "./errors.ts";

/** Successful raw UDP A2S_INFO query and transport diagnostics. */
export interface A2SInfoResult {
  readonly success: true;
  readonly transport: "udp";
  readonly host: string;
  readonly port: number;
  readonly local: { readonly address: string; readonly port: number };
  readonly remote: { readonly address: string; readonly port: number };
  readonly responseBytes: number;
  readonly elapsedMs: number;
  readonly packetType: "A2S_INFO";
  readonly timestamps: {
    readonly socketCreated: string;
    readonly packetSent: string;
    readonly responseReceived: string;
  };
  readonly server: A2SInfo;
}

/** Raw UDP Valve A2S query capability. */
export class A2SService extends Context.Tag("@kzg/A2SService")<
  A2SService,
  {
    readonly queryInfo: (
      host: string,
      port: number,
      timeoutMs: number
    ) => Effect.Effect<A2SInfoResult, A2SError>;
  }
>() {}
