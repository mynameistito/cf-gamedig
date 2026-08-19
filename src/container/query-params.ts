import { Result, Schema, SchemaTransformation } from "effect";

export const MAX_RETRIES = 3;
export const MAX_SOCKET_TIMEOUT_MS = 15_000;
export const MAX_ATTEMPT_TIMEOUT_MS = 60_000;

const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_SOCKET_TIMEOUT_MS = 2000;
const PORT_ERROR = "Invalid port: expected an integer between 1 and 65535";
const RETRY_ERROR = `Invalid maxRetries: expected an integer between 0 and ${MAX_RETRIES}`;
const SOCKET_TIMEOUT_ERROR = `Invalid socketTimeout: expected an integer between 1 and ${MAX_SOCKET_TIMEOUT_MS}`;
const ATTEMPT_TIMEOUT_ERROR = `Invalid attemptTimeout: expected an integer between 1 and ${MAX_ATTEMPT_TIMEOUT_MS}`;
const TEAMSPEAK_QUERY_PORT_ERROR =
  "Invalid teamspeakQueryPort: expected an integer between 1 and 65535";
const TELNET_PORT_ERROR =
  "Invalid telnetPort: expected an integer between 1 and 65535";
const TIMEOUT_RELATIONSHIP_ERROR =
  "Invalid timeouts: attemptTimeout must be greater than socketTimeout";
const taggedError = Schema.TaggedError;

export const SENSITIVE_QUERY_OPTIONS = [
  "apiKey",
  "password",
  "telnetPassword",
  "token",
] as const;

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

const decodeIpFamily = (value: "0" | "4" | "6") => {
  if (value === "0") {
    return 0;
  }
  if (value === "4") {
    return 4;
  }
  return 6;
};

const encodeIpFamily = (value: 0 | 4 | 6) => {
  if (value === 0) {
    return "0";
  }
  if (value === 4) {
    return "4";
  }
  return "6";
};

const IpFamilySchema = Schema.Literals(["0", "4", "6"]).pipe(
  Schema.decodeTo(
    Schema.Literals([0, 4, 6]),
    SchemaTransformation.transform({
      decode: decodeIpFamily,
      encode: encodeIpFamily,
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

const boundedInteger = (minimum: number, maximum: number, message: string) =>
  Schema.Number.pipe(
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
const TeamspeakQueryPortSchema = boundedIntegerFromString(
  1,
  65_535,
  TEAMSPEAK_QUERY_PORT_ERROR
);
const TelnetPortSchema = boundedIntegerFromString(1, 65_535, TELNET_PORT_ERROR);

const PostMaxRetriesSchema = boundedInteger(0, MAX_RETRIES, RETRY_ERROR);
const PostSocketTimeoutSchema = boundedInteger(
  1,
  MAX_SOCKET_TIMEOUT_MS,
  SOCKET_TIMEOUT_ERROR
);
const PostAttemptTimeoutSchema = boundedInteger(
  1,
  MAX_ATTEMPT_TIMEOUT_MS,
  ATTEMPT_TIMEOUT_ERROR
);
const PostPortSchema = boundedInteger(1, 65_535, PORT_ERROR);
const PostTeamspeakQueryPortSchema = boundedInteger(
  1,
  65_535,
  TEAMSPEAK_QUERY_PORT_ERROR
);
const PostTelnetPortSchema = boundedInteger(1, 65_535, TELNET_PORT_ERROR);
const SnapshotIntervalSchema = Schema.Literals([
  "1h",
  "6h",
  "12h",
  "1d",
  "3d",
  "1w",
  "2w",
  "4w",
]);

const QueryParamsSchema = Schema.Struct({
  accountId: Schema.optionalKey(
    requiredString("Invalid accountId: expected a non-empty string")
  ),
  address: Schema.optionalKey(
    requiredString("Invalid address: expected a non-empty string")
  ),
  apiKey: Schema.optionalKey(
    requiredString("Invalid apiKey: expected a non-empty string")
  ),
  attemptTimeout: AttemptTimeoutSchema,
  checkOldIDs: BooleanFromStringSchema,
  debug: BooleanFromStringSchema,
  givenPortOnly: BooleanFromStringSchema,
  guildId: Schema.optionalKey(
    requiredString("Invalid guildId: expected a non-empty string")
  ),
  host: requiredString("Missing required parameter: host"),
  ipFamily: IpFamilySchema,
  login: Schema.optionalKey(
    requiredString("Invalid login: expected a non-empty string")
  ),
  maxRetries: MaxRetriesSchema,
  moreData: Schema.optionalKey(BooleanFromStringSchema),
  noBreadthOrder: BooleanFromStringSchema,
  password: Schema.optionalKey(
    requiredString("Invalid password: expected a non-empty string")
  ),
  port: Schema.optionalKey(PortSchema),
  rejectUnauthorized: Schema.optionalKey(BooleanFromStringSchema),
  requestPlayers: BooleanFromStringSchema,
  requestPlayersRequired: BooleanFromStringSchema,
  requestRules: BooleanFromStringSchema,
  requestRulesRequired: BooleanFromStringSchema,
  serverId: Schema.optionalKey(
    requiredString("Invalid serverId: expected a non-empty string")
  ),
  snapshotInterval: Schema.optionalKey(SnapshotIntervalSchema),
  socketTimeout: SocketTimeoutSchema,
  stripColors: BooleanFromStringSchema,
  teamspeakQueryPort: Schema.optionalKey(TeamspeakQueryPortSchema),
  telnetPassword: Schema.optionalKey(
    requiredString("Invalid telnetPassword: expected a non-empty string")
  ),
  telnetPort: Schema.optionalKey(TelnetPortSchema),
  token: Schema.optionalKey(
    requiredString("Invalid token: expected a non-empty string")
  ),
  type: requiredString("Missing required parameter: type"),
  username: Schema.optionalKey(
    requiredString("Invalid username: expected a non-empty string")
  ),
});

const PostQueryOptionsSchema = Schema.Struct({
  accountId: Schema.optionalKey(
    requiredString("Invalid accountId: expected a non-empty string")
  ),
  address: Schema.optionalKey(
    requiredString("Invalid address: expected a non-empty string")
  ),
  apiKey: Schema.optionalKey(
    requiredString("Invalid apiKey: expected a non-empty string")
  ),
  attemptTimeout: Schema.optionalKey(PostAttemptTimeoutSchema),
  checkOldIDs: Schema.optionalKey(Schema.Boolean),
  debug: Schema.optionalKey(Schema.Boolean),
  givenPortOnly: Schema.optionalKey(Schema.Boolean),
  guildId: Schema.optionalKey(
    requiredString("Invalid guildId: expected a non-empty string")
  ),
  ipFamily: Schema.optionalKey(Schema.Literals([0, 4, 6])),
  login: Schema.optionalKey(
    requiredString("Invalid login: expected a non-empty string")
  ),
  maxRetries: Schema.optionalKey(PostMaxRetriesSchema),
  moreData: Schema.optionalKey(Schema.Boolean),
  noBreadthOrder: Schema.optionalKey(Schema.Boolean),
  password: Schema.optionalKey(
    requiredString("Invalid password: expected a non-empty string")
  ),
  rejectUnauthorized: Schema.optionalKey(Schema.Boolean),
  requestPlayers: Schema.optionalKey(Schema.Boolean),
  requestPlayersRequired: Schema.optionalKey(Schema.Boolean),
  requestRules: Schema.optionalKey(Schema.Boolean),
  requestRulesRequired: Schema.optionalKey(Schema.Boolean),
  serverId: Schema.optionalKey(
    requiredString("Invalid serverId: expected a non-empty string")
  ),
  snapshotInterval: Schema.optionalKey(SnapshotIntervalSchema),
  socketTimeout: Schema.optionalKey(PostSocketTimeoutSchema),
  stripColors: Schema.optionalKey(Schema.Boolean),
  teamspeakQueryPort: Schema.optionalKey(PostTeamspeakQueryPortSchema),
  telnetPassword: Schema.optionalKey(
    requiredString("Invalid telnetPassword: expected a non-empty string")
  ),
  telnetPort: Schema.optionalKey(PostTelnetPortSchema),
  token: Schema.optionalKey(
    requiredString("Invalid token: expected a non-empty string")
  ),
  username: Schema.optionalKey(
    requiredString("Invalid username: expected a non-empty string")
  ),
});

export const PostQueryRequestSchema = Schema.Struct({
  host: requiredString("Missing required parameter: host"),
  options: Schema.optionalKey(PostQueryOptionsSchema),
  port: Schema.optionalKey(PostPortSchema),
  type: requiredString("Missing required parameter: type"),
});

export type QueryParams = typeof QueryParamsSchema.Type;
export type PostQueryRequest = typeof PostQueryRequestSchema.Type;
export type PublicQueryParams = Omit<
  QueryParams,
  "apiKey" | "password" | "telnetPassword" | "token"
>;

const invalidQuery = (message: string) => new InvalidQueryError({ message });

const queryParamOr = (
  searchParams: URLSearchParams,
  name: string,
  fallback: string
): string => searchParams.get(name)?.trim() ?? fallback;

const addOptionalQueryParam = (
  values: Record<string, string>,
  searchParams: URLSearchParams,
  name: string
): void => {
  const value = searchParams.get(name)?.trim();
  if (value !== undefined) {
    values[name] = value;
  }
};

const firstMessageLine = (message: string | undefined): string => {
  if (message === undefined) {
    return "Invalid query";
  }
  const lineEnd = message.indexOf("\n");
  return lineEnd === -1 ? message : message.slice(0, lineEnd);
};

const checkTimeoutRelationship = (
  query: QueryParams
): Result.Result<QueryParams, InvalidQueryError> =>
  query.attemptTimeout <= query.socketTimeout
    ? Result.fail(invalidQuery(TIMEOUT_RELATIONSHIP_ERROR))
    : Result.succeed(query);

export const findSensitiveQueryParameter = (
  searchParams: URLSearchParams
): (typeof SENSITIVE_QUERY_OPTIONS)[number] | undefined => {
  for (const name of SENSITIVE_QUERY_OPTIONS) {
    if (searchParams.has(name)) {
      return name;
    }
  }
  return undefined;
};

export const parseQueryParams = (
  searchParams: URLSearchParams
): Result.Result<QueryParams, InvalidQueryError> => {
  const values = {
    attemptTimeout: queryParamOr(
      searchParams,
      "attemptTimeout",
      String(DEFAULT_ATTEMPT_TIMEOUT_MS)
    ),
    checkOldIDs: queryParamOr(searchParams, "checkOldIDs", "false"),
    debug: queryParamOr(searchParams, "debug", "false"),
    givenPortOnly: queryParamOr(searchParams, "givenPortOnly", "false"),
    host: queryParamOr(searchParams, "host", ""),
    ipFamily: queryParamOr(searchParams, "ipFamily", "0"),
    maxRetries: queryParamOr(
      searchParams,
      "maxRetries",
      String(DEFAULT_MAX_RETRIES)
    ),
    noBreadthOrder: queryParamOr(searchParams, "noBreadthOrder", "false"),
    requestPlayers: queryParamOr(searchParams, "requestPlayers", "true"),
    requestPlayersRequired: queryParamOr(
      searchParams,
      "requestPlayersRequired",
      "false"
    ),
    requestRules: queryParamOr(searchParams, "requestRules", "false"),
    requestRulesRequired: queryParamOr(
      searchParams,
      "requestRulesRequired",
      "false"
    ),
    socketTimeout: queryParamOr(
      searchParams,
      "socketTimeout",
      String(DEFAULT_SOCKET_TIMEOUT_MS)
    ),
    stripColors: queryParamOr(searchParams, "stripColors", "true"),
    type: queryParamOr(searchParams, "type", ""),
  } satisfies Record<string, string>;

  for (const name of [
    "accountId",
    "address",
    "guildId",
    "login",
    "moreData",
    "port",
    "rejectUnauthorized",
    "serverId",
    "snapshotInterval",
    "teamspeakQueryPort",
    "telnetPort",
    "username",
  ]) {
    addOptionalQueryParam(values, searchParams, name);
  }

  return Result.flatMap(
    Result.mapError(
      Schema.decodeUnknownResult(QueryParamsSchema)(values),
      (failure) => invalidQuery(firstMessageLine(failure.message))
    ),
    checkTimeoutRelationship
  );
};

export const parsePostQuery = (
  request: PostQueryRequest
): Result.Result<QueryParams, InvalidQueryError> => {
  const options = request.options ?? {};
  const queryWithoutPort: QueryParams = {
    attemptTimeout: options.attemptTimeout ?? DEFAULT_ATTEMPT_TIMEOUT_MS,
    checkOldIDs: options.checkOldIDs ?? false,
    debug: options.debug ?? false,
    givenPortOnly: options.givenPortOnly ?? false,
    host: request.host,
    ipFamily: options.ipFamily ?? 0,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    noBreadthOrder: options.noBreadthOrder ?? false,
    requestPlayers: options.requestPlayers ?? true,
    requestPlayersRequired: options.requestPlayersRequired ?? false,
    requestRules: options.requestRules ?? false,
    requestRulesRequired: options.requestRulesRequired ?? false,
    socketTimeout: options.socketTimeout ?? DEFAULT_SOCKET_TIMEOUT_MS,
    stripColors: options.stripColors ?? true,
    type: request.type,
    ...options,
  };
  const query =
    request.port === undefined
      ? queryWithoutPort
      : { ...queryWithoutPort, port: request.port };

  return checkTimeoutRelationship(query);
};

export const toPublicQueryParams = ({
  apiKey: _apiKey,
  password: _password,
  telnetPassword: _telnetPassword,
  token: _token,
  ...query
}: QueryParams): PublicQueryParams => query;
