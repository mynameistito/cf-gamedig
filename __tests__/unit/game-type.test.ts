import { describe, expect, test } from "bun:test";

import { Result } from "effect";
import { games, protocols } from "gamedig";

import { parseGameType } from "../../src/container/game-type.ts";

const findOldOnlyId = (): string => {
  const oldOnlyEntry = Object.values(games).find(
    (game) =>
      game.extra?.old_id !== undefined &&
      !Object.hasOwn(games, game.extra.old_id)
  );
  const oldId = oldOnlyEntry?.extra?.old_id;
  if (oldId === undefined) {
    throw new Error("Installed GameDig registry has no old-only game ID");
  }
  return oldId;
};

describe("GameDig game type parsing", () => {
  test("accepts canonical IDs from the installed GameDig registry", () => {
    const ids = Object.keys(games);
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const result = parseGameType(id, false);
      expect(Result.isSuccess(result)).toBe(true);
      if (Result.isSuccess(result)) {
        expect(result.success).toBe(id);
      }
    }
  });

  test("accepts every installed protocol-forcing ID", () => {
    const ids = Object.keys(protocols);
    expect(ids.length).toBeGreaterThan(0);

    for (const protocol of ids) {
      expect(Result.isSuccess(parseGameType(`protocol-${protocol}`, false))).toBe(
        true
      );
    }
  });

  test("honors checkOldIDs for an old-only runtime ID", () => {
    const oldId = findOldOnlyId();
    expect(Result.isFailure(parseGameType(oldId, false))).toBe(true);
    expect(Result.isSuccess(parseGameType(oldId, true))).toBe(true);
  });

  test("preserves GameDig's case-sensitive ID behavior", () => {
    expect(Result.isSuccess(parseGameType("minecraft", false))).toBe(true);
    expect(Result.isFailure(parseGameType("Minecraft", false))).toBe(true);
    expect(Result.isFailure(parseGameType("PROTOCOL-QUAKE3", false))).toBe(
      true
    );
  });

  test("trims surrounding whitespace but rejects unknown or empty IDs", () => {
    const trimmed = parseGameType("  minecraft  ", false);
    expect(Result.isSuccess(trimmed)).toBe(true);
    if (Result.isSuccess(trimmed)) {
      expect(trimmed.success).toBe("minecraft");
    }

    for (const value of ["", "   ", "definitely-not-a-gamedig-id"]) {
      expect(Result.isFailure(parseGameType(value, false))).toBe(true);
    }
  });
});
