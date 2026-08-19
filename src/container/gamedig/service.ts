import { Context } from "effect3";
import type { Effect } from "effect3";

import type { GameServerStatus } from "../../shared/schema.ts";
import type { GameDigError } from "./errors.ts";

/** Normalized GameDig query capability. */
export class GameDigService extends Context.Tag("@cf-gamedig/GameDigService")<
  GameDigService,
  {
    readonly query: (
      type: string,
      host: string,
      port: number
    ) => Effect.Effect<GameServerStatus, GameDigError>;
  }
>() {}
