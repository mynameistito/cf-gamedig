import { Effect, Schema, SchemaTransformation } from "effect";

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

const PlayerCountSchema = Schema.Union([
  Schema.Number,
  Schema.FiniteFromString,
]);

const PasswordStringSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) => {
        const normalized = value.toLowerCase();
        return normalized === "true" || normalized === "yes" || value === "1";
      },
      encode: (value) => (value ? "1" : "0"),
    })
  )
);

const PasswordSchema = Schema.Union([Schema.Boolean, PasswordStringSchema]);

const GameDigPlayerSchema = Schema.Struct({
  name: Schema.String,
  raw: UnknownRecordSchema.pipe(
    Schema.withDecodingDefault(Effect.succeed({}))
  ),
});

export const GameDigResultSchema = Schema.Struct({
  bots: Schema.Array(GameDigPlayerSchema),
  connect: Schema.String,
  map: Schema.String,
  maxplayers: PlayerCountSchema,
  name: Schema.String,
  numplayers: PlayerCountSchema,
  password: PasswordSchema,
  ping: Schema.Number,
  players: Schema.Array(GameDigPlayerSchema),
  queryPort: Schema.Number,
  raw: UnknownRecordSchema,
  version: Schema.String,
});

export type GameDigResult = typeof GameDigResultSchema.Type;
