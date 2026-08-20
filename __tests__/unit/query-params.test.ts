import { describe, expect, test } from "bun:test";

import { Result, Schema } from "effect";

import type { QueryParams } from "../../src/container/query-params.ts";
import {
  MAX_ATTEMPT_TIMEOUT_MS,
  MAX_RETRIES,
  MAX_SOCKET_TIMEOUT_MS,
  parsePostQuery,
  parseQueryParams,
  PostQueryRequestSchema,
} from "../../src/container/query-params.ts";

const BASE_QUERY = "?type=minecraft&host=play.example.com";
const DEFAULT_QUERY: QueryParams = {
  attemptTimeout: 10_000,
  checkOldIDs: false,
  debug: false,
  givenPortOnly: false,
  host: "play.example.com",
  ipFamily: 0,
  maxRetries: 1,
  noBreadthOrder: false,
  requestPlayers: true,
  requestPlayersRequired: false,
  requestRules: false,
  requestRulesRequired: false,
  socketTimeout: 2000,
  stripColors: true,
  type: "minecraft",
};

const parse = (search: string) =>
  parseQueryParams(
    new URL(`https://container.local/query${search}`).searchParams
  );

const parseOk = (search: string): QueryParams => {
  const result = parse(search);
  if (Result.isFailure(result)) {
    throw new Error(`Expected query to parse: ${result.failure.message}`);
  }
  return result.success;
};

const parseError = (search: string): string => {
  const result = parse(search);
  if (Result.isSuccess(result)) {
    throw new Error("Expected query to fail");
  }
  expect(result.failure._tag).toBe("InvalidQuery");
  return result.failure.message;
};

describe("GET query parsing", () => {
  test("uses the exposed GameDig-compatible defaults", () => {
    expect(parseOk(BASE_QUERY)).toEqual(DEFAULT_QUERY);
  });

  test("parses every generic option to its runtime type", () => {
    expect(
      parseOk(
        `${BASE_QUERY}&address=203.0.113.10&port=25565&maxRetries=2&socketTimeout=5000&attemptTimeout=15000&givenPortOnly=true&ipFamily=4&debug=true&stripColors=false&noBreadthOrder=true&checkOldIDs=true&requestRules=true&requestPlayers=false&requestRulesRequired=true&requestPlayersRequired=true`
      )
    ).toEqual({
      address: "203.0.113.10",
      attemptTimeout: 15_000,
      checkOldIDs: true,
      debug: true,
      givenPortOnly: true,
      host: "play.example.com",
      ipFamily: 4,
      maxRetries: 2,
      noBreadthOrder: true,
      port: 25_565,
      requestPlayers: false,
      requestPlayersRequired: true,
      requestRules: true,
      requestRulesRequired: true,
      socketTimeout: 5000,
      stripColors: false,
      type: "minecraft",
    });
  });

  test("parses every non-sensitive protocol option exposed through GET", () => {
    const query = parseOk(
      `${BASE_QUERY}&accountId=acct&guildId=guild&login=SuperAdmin&moreData=true&rejectUnauthorized=false&serverId=server-42&snapshotInterval=6h&teamspeakQueryPort=10011&telnetPort=8081&username=admin`
    );

    expect(query).toMatchObject({
      accountId: "acct",
      guildId: "guild",
      login: "SuperAdmin",
      moreData: true,
      rejectUnauthorized: false,
      serverId: "server-42",
      snapshotInterval: "6h",
      teamspeakQueryPort: 10_011,
      telnetPort: 8081,
      username: "admin",
    });
  });

  test("keeps address separate from logical host and does not invent a port", () => {
    const query = parseOk(`${BASE_QUERY}&address=203.0.113.10&ipFamily=4`);
    expect(query.host).toBe("play.example.com");
    expect(query.address).toBe("203.0.113.10");
    expect(Object.hasOwn(query, "port")).toBe(false);
  });

  test("accepts numeric boundaries", () => {
    expect(parseOk(`${BASE_QUERY}&port=1`).port).toBe(1);
    expect(parseOk(`${BASE_QUERY}&port=65535`).port).toBe(65_535);
    expect(parseOk(`${BASE_QUERY}&maxRetries=0`).maxRetries).toBe(0);
    expect(parseOk(`${BASE_QUERY}&maxRetries=${MAX_RETRIES}`).maxRetries).toBe(
      MAX_RETRIES
    );

    const timeouts = parseOk(
      `${BASE_QUERY}&socketTimeout=${MAX_SOCKET_TIMEOUT_MS}&attemptTimeout=${MAX_ATTEMPT_TIMEOUT_MS}`
    );
    expect(timeouts.socketTimeout).toBe(MAX_SOCKET_TIMEOUT_MS);
    expect(timeouts.attemptTimeout).toBe(MAX_ATTEMPT_TIMEOUT_MS);
  });

  test("trims values and uses the first value for duplicate parameters", () => {
    const query = parseOk(
      "?type=%20minecraft%20&type=quake3&host=%20play.example.com%20&host=other.example.com&port=%2025565%20&port=27015"
    );

    expect(query).toMatchObject({
      host: "play.example.com",
      port: 25_565,
      type: "minecraft",
    });
  });

  test("rejects missing or empty required values", () => {
    expect(parseError("?host=example.com")).toBe(
      "Missing required parameter: type"
    );
    expect(parseError("?type=minecraft")).toBe(
      "Missing required parameter: host"
    );
    expect(parseError(`${BASE_QUERY}&address=`)).toBe(
      "Invalid address: expected a non-empty string"
    );
  });

  test("rejects invalid ports, retries, timeouts, IP families, and booleans", () => {
    for (const port of ["", "abc", "0", "65536", "27015.5"]) {
      expect(parseError(`${BASE_QUERY}&port=${port}`)).toBe(
        "Invalid port: expected an integer between 1 and 65535"
      );
    }

    for (const value of ["abc", "-1", "1.5", String(MAX_RETRIES + 1)]) {
      expect(Result.isFailure(parse(`${BASE_QUERY}&maxRetries=${value}`))).toBe(
        true
      );
    }
    for (const value of ["-1", "1", "5", "ipv4", "4.0"]) {
      expect(Result.isFailure(parse(`${BASE_QUERY}&ipFamily=${value}`))).toBe(
        true
      );
    }
    for (const option of [
      "checkOldIDs",
      "debug",
      "givenPortOnly",
      "moreData",
      "noBreadthOrder",
      "rejectUnauthorized",
      "requestPlayers",
      "requestPlayersRequired",
      "requestRules",
      "requestRulesRequired",
      "stripColors",
    ]) {
      expect(Result.isFailure(parse(`${BASE_QUERY}&${option}=1`))).toBe(true);
      expect(Result.isFailure(parse(`${BASE_QUERY}&${option}=TRUE`))).toBe(
        true
      );
    }
  });

  test("rejects timeout limits and invalid timeout relationships", () => {
    expect(
      Result.isFailure(
        parse(`${BASE_QUERY}&socketTimeout=${MAX_SOCKET_TIMEOUT_MS + 1}`)
      )
    ).toBe(true);
    expect(
      Result.isFailure(
        parse(`${BASE_QUERY}&attemptTimeout=${MAX_ATTEMPT_TIMEOUT_MS + 1}`)
      )
    ).toBe(true);
    expect(
      parseError(`${BASE_QUERY}&socketTimeout=5000&attemptTimeout=5000`)
    ).toBe(
      "Invalid timeouts: attemptTimeout must be greater than socketTimeout"
    );
  });

  test("ignores unknown and internal-only query parameters", () => {
    const query = parseOk(
      `${BASE_QUERY}&portCache=true&listenUdpPort=13337&unknownOption=value`
    );
    expect(Object.hasOwn(query, "portCache")).toBe(false);
    expect(Object.hasOwn(query, "listenUdpPort")).toBe(false);
    expect(Object.hasOwn(query, "unknownOption")).toBe(false);
  });
});

describe("POST query parsing", () => {
  const decodePost = (value: unknown) => {
    const decoded = Schema.decodeUnknownResult(PostQueryRequestSchema)(value);
    if (Result.isFailure(decoded)) {
      throw new Error(`Expected POST request to decode: ${decoded.failure.message}`);
    }
    return decoded.success;
  };

  test("applies defaults and preserves an omitted port", () => {
    const query = parsePostQuery(
      decodePost({ host: "play.example.com", type: "minecraft" })
    );
    expect(query).toEqual(Result.succeed(DEFAULT_QUERY));
    if (Result.isSuccess(query)) {
      expect(Object.hasOwn(query.success, "port")).toBe(false);
    }
  });

  test("accepts typed generic, protocol-specific, and credential options", () => {
    const decoded = decodePost({
      host: "example.com",
      options: {
        apiKey: "TEST_API_KEY",
        attemptTimeout: 15_000,
        debug: true,
        guildId: "123456789012345678",
        moreData: true,
        password: "TEST_PASSWORD",
        rejectUnauthorized: true,
        snapshotInterval: "6h",
        socketTimeout: 5000,
        teamspeakQueryPort: 10_011,
        telnetPassword: "TEST_TELNET_PASSWORD",
        telnetPort: 8081,
        token: "TEST_TOKEN",
        username: "admin",
      },
      port: 8212,
      type: "palworld",
    });
    const query = parsePostQuery(decoded);

    expect(Result.isSuccess(query)).toBe(true);
    if (Result.isSuccess(query)) {
      expect(query.success).toMatchObject({
        apiKey: "TEST_API_KEY",
        attemptTimeout: 15_000,
        debug: true,
        guildId: "123456789012345678",
        host: "example.com",
        password: "TEST_PASSWORD",
        port: 8212,
        socketTimeout: 5000,
        telnetPassword: "TEST_TELNET_PASSWORD",
        token: "TEST_TOKEN",
        type: "palworld",
        username: "admin",
      });
    }
  });

  test("rejects invalid typed values before they reach parsePostQuery", () => {
    for (const options of [
      { port: "25565" },
      { options: { debug: "true" } },
      { options: { ipFamily: 5 } },
      { options: { teamspeakQueryPort: "10011" } },
    ]) {
      const decoded = Schema.decodeUnknownResult(PostQueryRequestSchema)({
        host: "example.com",
        type: "minecraft",
        ...options,
      });
      expect(Result.isFailure(decoded)).toBe(true);
    }
  });

  test("enforces the timeout relationship after POST defaults are applied", () => {
    const decoded = decodePost({
      host: "example.com",
      options: { attemptTimeout: 5000, socketTimeout: 5000 },
      type: "minecraft",
    });
    const result = parsePostQuery(decoded);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toBe(
        "Invalid timeouts: attemptTimeout must be greater than socketTimeout"
      );
    }
  });
});
