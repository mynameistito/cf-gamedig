import { Schema } from "effect";

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

const GameDigPlayerSchema = Schema.Struct({
  name: Schema.String,
  raw: UnknownRecordSchema,
});

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
