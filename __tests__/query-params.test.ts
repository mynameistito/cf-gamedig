import { describe, expect, test } from "bun:test";

import { Result } from "effect";

import type { QueryParams } from "@/container/query-params.ts";
import {
  MAX_ATTEMPT_TIMEOUT_MS,
  MAX_RETRIES,
  MAX_SOCKET_TIMEOUT_MS,
  parseQueryParams,
} from "@/container/query-params.ts";

const parse = (search: string) =>
  parseQueryParams(
    new URL(`https://container.local/query${search}`).searchParams
  );

const parseOk = (search: string): QueryParams => {
  const result = parse(search);
  if (Result.isFailure(result)) {
    throw new Error(
      `Expected parse to succeed, got: ${result.failure.message}`
    );
  }
  return result.success;
};

const parseError = (search: string): string => {
  const result = parse(search);
  if (Result.isSuccess(result)) {
    throw new Error("Expected parse to fail");
  }
  expect(result.failure._tag).toBe("InvalidQuery");
  return result.failure.message;
};

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

describe("parseQueryParams", () => {
  test("uses GameDig defaults for generic options", () => {
    expect(parseOk(BASE_QUERY)).toEqual(DEFAULT_QUERY);
  });

  test("parses every supported generic option to its runtime type", () => {
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

  test("keeps address separate from the required logical host", () => {
    const query = parseOk(`${BASE_QUERY}&address=203.0.113.10&ipFamily=4`);

    expect(query.host).toBe("play.example.com");
    expect(query.address).toBe("203.0.113.10");
  });

  test("parses a query without a port", () => {
    const query = parseOk(BASE_QUERY);

    expect(Object.hasOwn(query, "port")).toBe(false);
  });

  test("accepts valid supplied port boundaries", () => {
    expect(parseOk(`${BASE_QUERY}&port=1`).port).toBe(1);
    expect(parseOk(`${BASE_QUERY}&port=65535`).port).toBe(65_535);
  });

  test("accepts maxRetries boundaries", () => {
    expect(parseOk(`${BASE_QUERY}&maxRetries=0`).maxRetries).toBe(0);
    expect(parseOk(`${BASE_QUERY}&maxRetries=${MAX_RETRIES}`).maxRetries).toBe(
      MAX_RETRIES
    );
  });

  test("accepts timeout upper bounds when their relationship is valid", () => {
    const query = parseOk(
      `${BASE_QUERY}&socketTimeout=${MAX_SOCKET_TIMEOUT_MS}&attemptTimeout=${MAX_ATTEMPT_TIMEOUT_MS}`
    );

    expect(query.socketTimeout).toBe(MAX_SOCKET_TIMEOUT_MS);
    expect(query.attemptTimeout).toBe(MAX_ATTEMPT_TIMEOUT_MS);
  });

  test("parses requestRules and requestPlayers independently", () => {
    const rulesOnly = parseOk(
      `${BASE_QUERY}&requestRules=true&requestPlayers=false`
    );
    const playersOnly = parseOk(
      `${BASE_QUERY}&requestRules=false&requestPlayers=true`
    );

    expect(rulesOnly.requestRules).toBe(true);
    expect(rulesOnly.requestPlayers).toBe(false);
    expect(playersOnly.requestRules).toBe(false);
    expect(playersOnly.requestPlayers).toBe(true);
  });

  test("parses required variants independently", () => {
    const query = parseOk(
      `${BASE_QUERY}&requestRulesRequired=true&requestPlayersRequired=true`
    );

    expect(query.requestRulesRequired).toBe(true);
    expect(query.requestPlayersRequired).toBe(true);
  });

  test("trims surrounding whitespace from string and numeric inputs", () => {
    expect(
      parseOk(
        "?type=%20minecraft%20&host=%20play.example.com%20&address=%20203.0.113.10%20&port=%2025565%20&maxRetries=%202%20"
      )
    ).toMatchObject({
      address: "203.0.113.10",
      host: "play.example.com",
      maxRetries: 2,
      port: 25_565,
      type: "minecraft",
    });
  });

  test("accepts any non-empty game type", () => {
    expect(
      Result.isSuccess(parse("?type=protocol-valve&host=example.com"))
    ).toBe(true);
    expect(
      Result.isSuccess(parse("?type=some-future-game&host=example.com"))
    ).toBe(true);
  });

  test("rejects missing or empty required strings", () => {
    expect(parseError("?host=example.com")).toBe(
      "Missing required parameter: type"
    );
    expect(parseError("?type=&host=example.com")).toBe(
      "Missing required parameter: type"
    );
    expect(parseError("?type=minecraft")).toBe(
      "Missing required parameter: host"
    );
    expect(parseError(`${BASE_QUERY}&address=`)).toBe(
      "Invalid address: expected a non-empty string"
    );
  });

  test("rejects invalid supplied ports", () => {
    for (const port of ["", "abc", "0", "65536", "27015.5"]) {
      expect(parseError(`${BASE_QUERY}&port=${port}`)).toBe(
        "Invalid port: expected an integer between 1 and 65535"
      );
    }
  });

  test("rejects invalid booleans for every public boolean option", () => {
    const booleanOptions = [
      "checkOldIDs",
      "debug",
      "givenPortOnly",
      "noBreadthOrder",
      "requestPlayers",
      "requestPlayersRequired",
      "requestRules",
      "requestRulesRequired",
      "stripColors",
    ];

    for (const option of booleanOptions) {
      expect(Result.isFailure(parse(`${BASE_QUERY}&${option}=1`))).toBe(true);
      expect(Result.isFailure(parse(`${BASE_QUERY}&${option}=TRUE`))).toBe(
        true
      );
    }
  });

  test("rejects invalid retry and timeout numbers", () => {
    for (const value of ["abc", "-1", "1.5"]) {
      expect(Result.isFailure(parse(`${BASE_QUERY}&maxRetries=${value}`))).toBe(
        true
      );
    }

    for (const option of ["socketTimeout", "attemptTimeout"]) {
      for (const value of ["abc", "0", "-1", "1.5"]) {
        expect(
          Result.isFailure(parse(`${BASE_QUERY}&${option}=${value}`))
        ).toBe(true);
      }
    }
  });

  test("rejects retry and timeout values above safety limits", () => {
    expect(
      Result.isFailure(parse(`${BASE_QUERY}&maxRetries=${MAX_RETRIES + 1}`))
    ).toBe(true);
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
  });

  test("rejects invalid ipFamily values", () => {
    for (const value of ["-1", "1", "5", "ipv4", "4.0"]) {
      expect(Result.isFailure(parse(`${BASE_QUERY}&ipFamily=${value}`))).toBe(
        true
      );
    }
  });

  test("rejects attemptTimeout values that are not greater than socketTimeout", () => {
    expect(
      parseError(`${BASE_QUERY}&socketTimeout=5000&attemptTimeout=5000`)
    ).toBe(
      "Invalid timeouts: attemptTimeout must be greater than socketTimeout"
    );
    expect(
      parseError(`${BASE_QUERY}&socketTimeout=5000&attemptTimeout=4999`)
    ).toBe(
      "Invalid timeouts: attemptTimeout must be greater than socketTimeout"
    );
  });

  test("does not expose internal or unknown URL parameters", () => {
    const query = parseOk(
      `${BASE_QUERY}&portCache=true&listenUdpPort=13337&unknownOption=value`
    );

    expect(Object.hasOwn(query, "portCache")).toBe(false);
    expect(Object.hasOwn(query, "listenUdpPort")).toBe(false);
    expect(Object.hasOwn(query, "unknownOption")).toBe(false);
  });
});
