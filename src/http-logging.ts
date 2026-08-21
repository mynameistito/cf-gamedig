import type { HttpCompletionMetadata } from "@/request-correlation.ts";

export type HttpLogLevel = "error" | "info" | "warn";
export type HttpLogSource = "Container" | "Worker";

export interface HttpLogPresentation {
  readonly level: HttpLogLevel;
  readonly message: string;
}

export const getHttpLogLevel = (status: number): HttpLogLevel => {
  if (status >= 500) {
    return "error";
  }
  if (status >= 400) {
    return "warn";
  }
  return "info";
};

export const formatHttpCompletionMessage = (
  source: HttpLogSource,
  metadata: HttpCompletionMetadata
): string =>
  `${source} ${metadata.method} ${metadata.route} ${metadata.status} ${metadata.elapsedMs}ms`;

export const makeHttpLogPresentation = (
  source: HttpLogSource,
  metadata: HttpCompletionMetadata
): HttpLogPresentation => ({
  level: getHttpLogLevel(metadata.status),
  message: formatHttpCompletionMessage(source, metadata),
});
