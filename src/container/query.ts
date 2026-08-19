import { Result, Schema } from "effect";

const requiredString = (message: string) =>
  Schema.String.pipe(
    Schema.annotateKey({ messageMissingKey: message }),
    Schema.check(Schema.isMinLength(1, { message }))
  );

const PortSchema = Schema.NumberFromString.pipe(
  Schema.check(
    Schema.isInt({
      message: "Invalid port: expected an integer between 1 and 65535",
    })
  ),
  Schema.check(
    Schema.isBetween(
      { maximum: 65_535, minimum: 1 },
      { message: "Invalid port: expected an integer between 1 and 65535" }
    )
  )
);

/** Validated parameters for the GameDig `/query` route. */
export const QueryParamsSchema = Schema.Struct({
  host: requiredString("Missing required parameter: host"),
  port: PortSchema,
  type: requiredString("Missing required parameter: type"),
});

export type QueryParams = typeof QueryParamsSchema.Type;

export type ParseQueryParamsResult =
  | { readonly ok: true; readonly params: QueryParams }
  | { readonly ok: false; readonly message: string };

/** Parse and validate `?type=&host=&port=` for the `/query` route. */
export const parseQueryParams = (
  searchParams: URLSearchParams
): ParseQueryParamsResult => {
  const raw = {
    host: searchParams.get("host")?.trim() ?? "",
    port: searchParams.get("port")?.trim() ?? "",
    type: searchParams.get("type")?.trim() ?? "",
  };
  const result = Schema.decodeUnknownResult(QueryParamsSchema)(raw);
  if (Result.isSuccess(result)) {
    return { ok: true, params: result.success };
  }
  return {
    message: result.failure.message?.split("\n")[0] ?? "Invalid query",
    ok: false,
  };
};
