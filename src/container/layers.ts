import { Config, Context, Data, Effect, Layer } from "effect3";

import { A2SServiceLive } from "./a2s/live.ts";
import { GameDigServiceLive } from "./gamedig/live.ts";

/** Server target and timeout configuration. */
export interface AppConfigValue {
  readonly host: string;
  readonly port: number;
  readonly a2sTimeoutMs: number;
}

/** Typed application configuration service. */
export class AppConfig extends Context.Tag("@kzg/AppConfig")<
  AppConfig,
  AppConfigValue
>() {}

/** Failure to parse runtime environment configuration. */
export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly message: string;
}> {}

/** Configuration loaded once from environment variables with POC defaults. */
export const AppConfigLive = Layer.effect(
  AppConfig,
  Config.all({
    a2sTimeoutMs: Config.integer("A2S_TIMEOUT").pipe(Config.withDefault(5000)),
    host: Config.string("CS2_HOST").pipe(Config.withDefault("103.212.227.45")),
    port: Config.integer("CS2_PORT").pipe(Config.withDefault(27_015)),
  }).pipe(
    Effect.filterOrFail(
      (config) =>
        config.port > 0 && config.port <= 65_535 && config.a2sTimeoutMs > 0,
      () =>
        new ConfigurationError({
          message: "CS2_PORT or A2S_TIMEOUT is outside its valid range",
        })
    ),
    Effect.mapError((error) =>
      error instanceof ConfigurationError
        ? error
        : new ConfigurationError({
            message: `Invalid application configuration: ${String(error)}`,
          })
    )
  )
);

/** Complete application dependency graph, built once at process startup. */
export const AppLive = Layer.mergeAll(
  AppConfigLive,
  A2SServiceLive,
  GameDigServiceLive
);
