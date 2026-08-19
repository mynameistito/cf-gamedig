import { Result, Schema, SchemaTransformation } from "effect";

export const MAX_RETRIES = 3;
export const MAX_SOCKET_TIMEOUT_MS = 15_000;
export const MAX_ATTEMPT_TIMEOUT_MS = 60_000;

const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_SOCKET_TIMEOUT_MS = 2_000;
const PORT_ERROR = "Invalid port: expected an integer between 1 and 65535";
const RETRY_ERROR = `Invalid maxRetries: expected an integer between 0 and ${MAX_RETRIES}`;
const SOCKET_TIMEOUT_ERROR = `Invalid socketTimeout: expected an integer between 1 and ${MAX_SOCKET_TIMEOUT_MS}`;
const ATTEMPT_TIMEOUT_ERROR = `Invalid attemptTimeout: expected an integer between 1 and ${MAX_ATTEMPT_TIMEOUT_MS}`;
const TIMEOUT_RELATIONSHIP_ERROR =
  "Invalid timeouts: attemptTimeout must be greater than socketTimeout";
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

const BooleanFromStringSchema = Schema.Literals(["false", "true"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) => value === "true",
      encode: (value) => (value ? "true" : "false"),
    })
  )
);

const IpFamilySchema = Schema.Literals(["0", "4", "6"]).pipe(
  Schema.decodeTo(
    Schema.Literals([0, 4, 6]),
    SchemaTransformation.transform({
      decode: (value) => (value === "0" ? 0 : value === "4" ? 4 : 6),
      encode: (value) => (value === 0 ? "0" : value === 4 ? "4" : "6"),
    })
  )
);

const boundedIntegerFromString = (
  minimum: number,
  maximum: number,
  message: string
) =>
  Schema.NumberFromString.pipe(
    Schema.check(Schema.isInt({ message })),
    Schema.check(Schema.isBetween({ maximum, minimum }, { message }))
  );

const MaxRetriesSchema = boundedIntegerFromString(0, MAX_RETRIES, RETRY_ERROR);
const SocketTimeoutSchema = boundedIntegerFromString(
  1,
  MAX_SOCKET_TIMEOUT_MS,
  SOCKET_TIMEOUT_ERROR
);
const AttemptTimeoutSchema = boundedIntegerFromString(
  1,
  MAX_ATTEMPT_TIMEOUT_MS,
  ATTEMPT_TIMEOUT_ERROR
);
const PortSchema = boundedIntegerFromString(1, 65_535, PORT_ERROR);

const QueryParamsSchema = Schema.Struct({
  address: Schema.optionalKey(
    requiredString("Invalid address: expected a non-empty string")
  ),
  attemptTimeout: AttemptTimeoutSchema,
  checkOldIDs: BooleanFromStringSchema,
  debug: BooleanFromStringSchema,
  givenPortOnly: BooleanFromStringSchema,
  host: requiredString("Missing required parameter: host"),
  ipFamily: IpFamilySchema,
  maxRetries: MaxRetriesSchema,
  noBreadthOrder: BooleanFromStringSchema,
  port: Schema.optionalKey(PortSchema),
  requestPlayers: BooleanFromStringSchema,
  requestPlayersRequired: BooleanFromStringSchema,
  requestRules: BooleanFromStringSchema,
  requestRulesRequired: BooleanFromStringSchema,
  socketTimeout: SocketTimeoutSchema,
  stripColors: BooleanFromStringSchema,
  type: requiredString("Missing required parameter: type"),
});

export type QueryParams = typeof QueryParamsSchema.Type;

const invalidQuery = (message: string) => new InvalidQueryError({ message });

export const parseQueryParams = (
  searchParams: URLSearchParams
): Result.Result<QueryParams, InvalidQueryError> => {
  const input: Record<string, string> = {
    attemptTimeout:
      searchParams.get("attemptTimeout")?.trim() ??
      String(DEFAULT_ATTEMPT_TIMEOUT_MS),
    checkOldIDs: searchParams.get("checkOldIDs")?.trim() ?? "false",
    debug: searchParams.get("debug")?.trim() ?? "false",
    givenPortOnly: searchParams.get("givenPortOnly")?.trim() ?? "false",
    host: searchParams.get("host")?.trim() ?? "",
    ipFamily: searchParams.get("ipFamily")?.trim() ?? "0",
    maxRetries:
      searchParams.get("maxRetries")?.trim() ?? String(DEFAULT_MAX_RETRIES),
    noBreadthOrder: searchParams.get("noBreadthOrder")?.trim() ?? "false",
    requestPlayers: searchParams.get("requestPlayers")?.trim() ?? "true",
    requestPlayersRequired:
      searchParams.get("requestPlayersRequired")?.trim() ?? "false",
    requestRules: searchParams.get("requestRules")?.trim() ?? "false",
    requestRulesRequired:
      searchParams.get("requestRulesRequired")?.trim() ?? "false",
    socketTimeout:
      searchParams.get("socketTimeout")?.trim() ??
      String(DEFAULT_SOCKET_TIMEOUT_MS),
    stripColors: searchParams.get("stripColors")?.trim() ?? "true",
    type: searchParams.get("type")?.trim() ?? "",
  };

  const address = searchParams.get("address");
  if (address !== null) {
    input.address = address.trim();
  }

  const port = searchParams.get("port");
  if (port !== null) {
    input.port = port.trim();
  }

  const decoded = Result.mapError(
    Schema.decodeUnknownResult(QueryParamsSchema)(input),
    (failure) => invalidQuery(failure.message?.split("\n")[0] ?? "Invalid query")
  );

  if (Result.isFailure(decoded)) {
    return decoded;
  }

  if (decoded.success.attemptTimeout <= decoded.success.socketTimeout) {
    return Result.fail(invalidQuery(TIMEOUT_RELATIONSHIP_ERROR));
  }

  return decoded;
};
