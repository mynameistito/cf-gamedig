import { Result, Schema } from "effect";

const PORT_ERROR = "Invalid port: expected an integer between 1 and 65535";

const requiredString = (message: string) =>
  Schema.String.pipe(
    Schema.annotateKey({ messageMissingKey: message }),
    Schema.check(Schema.isMinLength(1, { message }))
  );

const PortSchema = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt({ message: PORT_ERROR })),
  Schema.check(
    Schema.isBetween({ maximum: 65_535, minimum: 1 }, { message: PORT_ERROR })
  )
);

const QueryParamsSchema = Schema.Struct({
  host: requiredString("Missing required parameter: host"),
  port: PortSchema,
  type: requiredString("Missing required parameter: type"),
});

export type QueryParams = typeof QueryParamsSchema.Type;

export const parseQueryParams = (
  searchParams: URLSearchParams
): Result.Result<QueryParams, string> => {
  const input = {
    host: searchParams.get("host")?.trim() ?? "",
    port: searchParams.get("port")?.trim() ?? "",
    type: searchParams.get("type")?.trim() ?? "",
  };

  return Result.mapError(
    Schema.decodeUnknownResult(QueryParamsSchema)(input),
    (failure) => failure.message?.split("\n")[0] ?? "Invalid query"
  );
};
