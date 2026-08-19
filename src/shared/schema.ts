import { Schema } from "effect3";

/** Normalized GameDig result exposed by the HTTP API. */
export const GameServerStatusSchema = Schema.Struct({
  bots: Schema.optional(Schema.Number),
  connect: Schema.optional(Schema.String),
  map: Schema.String,
  maxPlayers: Schema.Number,
  name: Schema.String,
  online: Schema.Literal(true),
  ping: Schema.optional(Schema.Number),
  players: Schema.Number,
  queryPort: Schema.optional(Schema.Number),
  version: Schema.optional(Schema.String),
});

/** Normalized GameDig result exposed by the HTTP API. */
export type GameServerStatus = typeof GameServerStatusSchema.Type;
