import { Schema } from "effect";

/** Arbitrary protocol-specific data attached by GameDig. */
export const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

export type UnknownRecord = typeof UnknownRecordSchema.Type;

/** A single player or bot reported by GameDig. */
export const GameDigPlayerSchema = Schema.Struct({
  name: Schema.String,
  raw: UnknownRecordSchema,
});

export type GameDigPlayer = typeof GameDigPlayerSchema.Type;

/** The common cross-game result returned by the GameDig boundary. */
export const GameDigResultSchema = Schema.Struct({
  bots: Schema.Array(GameDigPlayerSchema),
  connect: Schema.String,
  map: Schema.String,
  maxplayers: Schema.Number,
  name: Schema.String,
  numplayers: Schema.Number,
  password: Schema.Boolean,
  ping: Schema.Number,
  players: Schema.Array(GameDigPlayerSchema),
  queryPort: Schema.Number,
  raw: UnknownRecordSchema,
  version: Schema.String,
});

export type GameDigResult = typeof GameDigResultSchema.Type;
