import { Result, Schema, SchemaTransformation } from "effect";

const PORT_ERROR = "Invalid port: expected an integer between 1 and 65535";
const taggedError = Schema.TaggedError;

class InvalidQueryError extends taggedError<InvalidQueryError>()(
  "InvalidQuery",
  { message: Schema.String }
) {}

const requiredString = (message: string) =>
  Schema.String.pipe(
    Schema.annotateKey({ messageMissingKey: message }),
    Schema.check(Schema.isMinLength(1, { message }))
  );

const GivenPortOnlySchema = Schema.Literals(["false", "true"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) => value === "true",
      encode: (value) => (value ? "true" : "false"),
    })
  )
);

const PortSchema = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt({ message: PORT_ERROR })),
  Schema.check(
    Schema.isBetween({ maximum: 65_535, minimum: 1 }, { message: PORT_ERROR })
  )
);

const QueryParamsSchema = Schema.Struct({
  givenPortOnly: GivenPortOnlySchema,
  host: requiredString("Missing required parameter: host"),
  port: Schema.optionalKey(PortSchema),
  type: requiredString("Missing required parameter: type"),
});

export type QueryParams = typeof QueryParamsSchema.Type;

export const parseQueryParams = (
  searchParams: URLSearchParams
): Result.Result<QueryParams, InvalidQueryError> => {
  const port = searchParams.get("port");
  const inputWithoutPort = {
    givenPortOnly: searchParams.get("givenPortOnly")?.trim() ?? "false",
    host: searchParams.get("host")?.trim() ?? "",
    type: searchParams.get("type")?.trim() ?? "",
  };
  const input = port === null ? inputWithoutPort : { ...inputWithoutPort, port: port.trim() };

  return Result.mapError(
    Schema.decodeUnknownResult(QueryParamsSchema)(input),
    (failure) =>
      new InvalidQueryError({
        message: failure.message?.split("\n")[0] ?? "Invalid query",
      })
  );
};
