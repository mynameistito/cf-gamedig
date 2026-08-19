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

/** Parsed subset of a Valve A2S_INFO response. */
export const A2SInfoSchema = Schema.Struct({
  appId: Schema.Number,
  bots: Schema.Number,
  environment: Schema.String,
  folder: Schema.String,
  game: Schema.String,
  map: Schema.String,
  maxPlayers: Schema.Number,
  name: Schema.String,
  players: Schema.Number,
  protocol: Schema.Number,
  serverType: Schema.String,
  vac: Schema.Number,
  version: Schema.String,
  visibility: Schema.Number,
});

/** Parsed subset of a Valve A2S_INFO response. */
export type A2SInfo = typeof A2SInfoSchema.Type;
