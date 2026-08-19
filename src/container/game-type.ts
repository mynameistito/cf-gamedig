import { Result, Schema } from "effect";
import { games, protocols } from "gamedig";

import type { QueryParams } from "./query-params.ts";

const taggedError = Schema.TaggedError;

class InvalidGameTypeError extends taggedError<InvalidGameTypeError>()(
  "InvalidQuery",
  { message: Schema.String }
) {}

const currentGameIds = new Set(Object.keys(games));
const protocolGameIds = new Set(
  Object.keys(protocols).map((protocol) => `protocol-${protocol}`)
);
const legacyGameIds = new Set(
  Object.values(games).flatMap((game) =>
    game.extra?.old_id === undefined ? [] : [game.extra.old_id]
  )
);

const invalidGameType = (type: string) =>
  new InvalidGameTypeError({ message: `Invalid type: ${type}` });

export const parseGameType = (
  type: string,
  checkOldIDs: boolean
): Result.Result<string, InvalidGameTypeError> => {
  const normalizedType = type.trim();
  const isCurrent = currentGameIds.has(normalizedType);
  const isProtocol = protocolGameIds.has(normalizedType);
  const isLegacy = checkOldIDs && legacyGameIds.has(normalizedType);

  return isCurrent || isProtocol || isLegacy
    ? Result.succeed(normalizedType)
    : Result.fail(invalidGameType(normalizedType));
};

export const parseGameTypeQuery = (
  query: QueryParams
): Result.Result<QueryParams, InvalidGameTypeError> =>
  Result.map(parseGameType(query.type, query.checkOldIDs), (type) => ({
    ...query,
    type,
  }));
