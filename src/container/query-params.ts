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
const POST_QUERY_ERROR = "Invalid POST /query body";
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
const TelnetPortSchema = boundedIntegerFromString(
  1,
  65_535,
  TELNET_PORT_ERROR
);

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

const PostQueryRequestSchema = Schema.Struct({
  host: requiredString("Missing required parameter: host"),
  options: Schema.optionalKey(PostQueryOptionsSchema),
  port: Schema.optionalKey(PostPortSchema),
  type: requiredString("Missing required parameter: type"),
});

export type QueryParams = typeof QueryParamsSchema.Type;

export interface PublicQueryParams {
  readonly accountId?: string;
  readonly address?: string;
  readonly attemptTimeout: number;
  readonly checkOldIDs: boolean;
  readonly debug: boolean;
  readonly givenPortOnly: boolean;
  readonly guildId?: string;
  readonly host: string;
  readonly ipFamily: 0 | 4 | 6;
  readonly login?: string;
  readonly maxRetries: number;
  readonly moreData?: boolean;
  readonly noBreadthOrder: boolean;
  readonly port?: number;
  readonly rejectUnauthorized?: boolean;
  readonly requestPlayers: boolean;
  readonly requestPlayersRequired: boolean;
  readonly requestRules: boolean;
  readonly requestRulesRequired: boolean;
  readonly serverId?: string;
  readonly snapshotInterval?: "1h" | "6h" | "12h" | "1d" | "3d" | "1w" | "2w" | "4w";
  readonly socketTimeout: number;
  readonly stripColors: boolean;
  readonly teamspeakQueryPort?: number;
  readonly telnetPort?: number;
  readonly type: string;
  readonly username?: string;
}

const invalidQuery = (message: string) => new InvalidQueryError({ message });

const queryParamOr = (
  searchParams: URLSearchParams,
  name: string,
  fallback: string
): string => searchParams.get(name)?.trim() ?? fallback;

const optionalQueryParam = (
  searchParams: URLSearchParams,
  name: string
): string | undefined => searchParams.get(name)?.trim();

const checkTimeoutRelationship = (
  query: QueryParams
): Result.Result<QueryParams, InvalidQueryError> =>
  query.attemptTimeout <= query.socketTimeout
    ? Result.fail(invalidQuery(TIMEOUT_RELATIONSHIP_ERROR))
    : Result.succeed(query);

export const findSensitiveQueryParameter = (
  searchParams: URLSearchParams
): (typeof SENSITIVE_QUERY_OPTIONS)[number] | undefined =>
  SENSITIVE_QUERY_OPTIONS.find((name) => searchParams.has(name));

export const parseQueryParams = (
  searchParams: URLSearchParams
): Result.Result<QueryParams, InvalidQueryError> => {
  const address = optionalQueryParam(searchParams, "address");
  const accountId = optionalQueryParam(searchParams, "accountId");
  const guildId = optionalQueryParam(searchParams, "guildId");
  const login = optionalQueryParam(searchParams, "login");
  const moreData = optionalQueryParam(searchParams, "moreData");
  const port = optionalQueryParam(searchParams, "port");
  const rejectUnauthorized = optionalQueryParam(
    searchParams,
    "rejectUnauthorized"
  );
  const serverId = optionalQueryParam(searchParams, "serverId");
  const snapshotInterval = optionalQueryParam(searchParams, "snapshotInterval");
  const teamspeakQueryPort = optionalQueryParam(
    searchParams,
    "teamspeakQueryPort"
  );
  const telnetPort = optionalQueryParam(searchParams, "telnetPort");
  const username = optionalQueryParam(searchParams, "username");

  const input = {
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
    ...(accountId === undefined ? {} : { accountId }),
    ...(address === undefined ? {} : { address }),
    ...(guildId === undefined ? {} : { guildId }),
    ...(login === undefined ? {} : { login }),
    ...(moreData === undefined ? {} : { moreData }),
    ...(port === undefined ? {} : { port }),
    ...(rejectUnauthorized === undefined ? {} : { rejectUnauthorized }),
    ...(serverId === undefined ? {} : { serverId }),
    ...(snapshotInterval === undefined ? {} : { snapshotInterval }),
    ...(teamspeakQueryPort === undefined ? {} : { teamspeakQueryPort }),
    ...(telnetPort === undefined ? {} : { telnetPort }),
    ...(username === undefined ? {} : { username }),
  };

  return Result.flatMap(
    Result.mapError(
      Schema.decodeUnknownResult(QueryParamsSchema)(input),
      (failure) =>
        invalidQuery(failure.message?.split("\n")[0] ?? "Invalid query")
    ),
    checkTimeoutRelationship
  );
};

export const parsePostQuery = (
  input: unknown
): Result.Result<QueryParams, InvalidQueryError> => {
  const decoded = Result.mapError(
    Schema.decodeUnknownResult(PostQueryRequestSchema)(input),
    () => invalidQuery(POST_QUERY_ERROR)
  );

  return Result.flatMap(decoded, (request) => {
    const options = request.options ?? {};
    const query: QueryParams = {
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
      ...(request.port === undefined ? {} : { port: request.port }),
    };

    return checkTimeoutRelationship(query);
  });
};

export const toPublicQueryParams = (query: QueryParams): PublicQueryParams => ({
  attemptTimeout: query.attemptTimeout,
  checkOldIDs: query.checkOldIDs,
  debug: query.debug,
  givenPortOnly: query.givenPortOnly,
  host: query.host,
  ipFamily: query.ipFamily,
  maxRetries: query.maxRetries,
  noBreadthOrder: query.noBreadthOrder,
  requestPlayers: query.requestPlayers,
  requestPlayersRequired: query.requestPlayersRequired,
  requestRules: query.requestRules,
  requestRulesRequired: query.requestRulesRequired,
  socketTimeout: query.socketTimeout,
  stripColors: query.stripColors,
  type: query.type,
  ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
  ...(query.address === undefined ? {} : { address: query.address }),
  ...(query.guildId === undefined ? {} : { guildId: query.guildId }),
  ...(query.login === undefined ? {} : { login: query.login }),
  ...(query.moreData === undefined ? {} : { moreData: query.moreData }),
  ...(query.port === undefined ? {} : { port: query.port }),
  ...(query.rejectUnauthorized === undefined
    ? {}
    : { rejectUnauthorized: query.rejectUnauthorized }),
  ...(query.serverId === undefined ? {} : { serverId: query.serverId }),
  ...(query.snapshotInterval === undefined
    ? {}
    : { snapshotInterval: query.snapshotInterval }),
  ...(query.teamspeakQueryPort === undefined
    ? {}
    : { teamspeakQueryPort: query.teamspeakQueryPort }),
  ...(query.telnetPort === undefined ? {} : { telnetPort: query.telnetPort }),
  ...(query.username === undefined ? {} : { username: query.username }),
});
