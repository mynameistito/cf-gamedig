import { games } from "gamedig";

/** Validated parameters for the GameDig `/query` route. */
export interface QueryParams {
  readonly type: string;
  readonly host: string;
  readonly port: number;
}

export type ParseQueryParamsResult =
  | { readonly ok: true; readonly params: QueryParams }
  | { readonly ok: false; readonly message: string };

/** GameDig is keyed by these identifiers and also accepts `protocol-` prefixes. */
const isKnownGameType = (type: string): boolean =>
  Object.hasOwn(games, type) || type.startsWith("protocol-");

/** Parse and validate `?type=&host=&port=` for the `/query` route. */
export const parseQueryParams = (
  searchParams: URLSearchParams
): ParseQueryParamsResult => {
  const type = searchParams.get("type")?.trim() ?? "";
  if (!type) {
    return { message: "Missing required parameter: type", ok: false };
  }
  if (!isKnownGameType(type)) {
    return { message: `Unknown game type: ${type}`, ok: false };
  }

  const host = searchParams.get("host")?.trim() ?? "";
  if (!host) {
    return { message: "Missing required parameter: host", ok: false };
  }

  const rawPort = searchParams.get("port")?.trim() ?? "";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return {
      message: "Invalid port: expected an integer between 1 and 65535",
      ok: false,
    };
  }

  return { ok: true, params: { host, port, type } };
};
