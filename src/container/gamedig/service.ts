import { Context } from "effect";
import type { Effect } from "effect";

import type { GameServerStatus } from "../../shared/schema.ts";
import type { GameDigError } from "./errors.ts";

/** Normalized GameDig query capability. */
export class GameDigService extends Context.Service<
  GameDigService,
  {
    readonly query: (
      type: string,
      host: string,
      port: number
    ) => Effect.Effect<GameServerStatus, GameDigError>;
  }
>()("@cf-gamedig/GameDigService") {}
