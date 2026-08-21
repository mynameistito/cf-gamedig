import { Effect, Logger } from "effect";

import { makeHttpLogPresentation } from "@/http-logging.ts";
import type { HttpCompletionMetadata } from "@/request-correlation.ts";

export const containerLoggingLayer = Logger.layer([
  Logger.withLeveledConsole(Logger.formatJson),
]);

const logHttpMessage = (
  level: "error" | "info" | "warn",
  message: string
): Effect.Effect<void> => {
  switch (level) {
    case "error": {
      return Effect.logError(message);
    }
    case "warn": {
      return Effect.logWarning(message);
    }
    default: {
      return Effect.logInfo(message);
    }
  }
};

export const logContainerHttpCompletion = (
  metadata: HttpCompletionMetadata
): Effect.Effect<void> => {
  const presentation = makeHttpLogPresentation("Container", metadata);
  return logHttpMessage(presentation.level, presentation.message).pipe(
    Effect.annotateLogs({ event: "container_http_completed", ...metadata })
  );
};
