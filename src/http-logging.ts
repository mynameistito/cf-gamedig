import type { HttpCompletionMetadata } from "@/request-correlation.ts";

/**
 * Severity used for HTTP completion logs.
 */
export type HttpLogLevel = "error" | "info" | "warn";

/**
 * Component that handled the request.
 */
export type HttpLogSource = "Container" | "Worker";

/**
 * Formatted HTTP log message and severity.
 */
export interface HttpLogPresentation {
  readonly level: HttpLogLevel;
  readonly message: string;
}

/**
 * Choose a log level from an HTTP status.
 * @param status - HTTP response status.
 * @returns The corresponding log level.
 */
export const getHttpLogLevel = (status: number): HttpLogLevel => {
  if (status >= 500) {
    return "error";
  }

  if (status >= 400) {
    return "warn";
  }

  return "info";
};

/**
 * Format a safe HTTP completion message.
 * @param source - Component handling the request.
 * @param metadata - Completion fields.
 * @returns A concise log message.
 */
export const formatHttpCompletionMessage = (
  source: HttpLogSource,
  metadata: HttpCompletionMetadata
): string =>
  `${source} ${metadata.method} ${metadata.route} ${metadata.status} ${metadata.elapsedMs}ms`;

/**
 * Prepare the severity and message for an HTTP completion log.
 * @param source - Component handling the request.
 * @param metadata - Completion fields.
 * @returns Log presentation fields.
 */
export const makeHttpLogPresentation = (
  source: HttpLogSource,
  metadata: HttpCompletionMetadata
): HttpLogPresentation => ({
  level: getHttpLogLevel(metadata.status),
  message: formatHttpCompletionMessage(source, metadata),
});
