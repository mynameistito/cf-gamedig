/** Payload shared by all GameDig adapter failures. */
export interface GameDigErrorFields {
  readonly type: string;
  readonly host: string;
  readonly port: number;
  readonly message: string;
  readonly elapsedMs: number;
}
