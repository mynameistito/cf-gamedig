import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";

const jsPlugins = selectJsPlugins(["github", "sonarjs", "jsdoc-js", "tsdoc"]);

export default defineConfig({
  env: core.env,
  extends: [core, antiSlop, jsPlugins],
  ignorePatterns: core.ignorePatterns,
  jsPlugins: jsPlugins.jsPlugins,
  options: { typeAware: true },
  overrides: [
    {
      files: ["**/*.{ts,tsx,mts,cts}"],
      // TSDoc forbids the JSDoc type expression required by this rule.
      rules: { "jsdoc/require-throws-type": "off" },
    },
    {
      files: [
        "__tests__/e2e/docker-e2e.ts",
        "__tests__/integration/gamedig-service.test.ts",
        "__tests__/integration/request-correlation.test.ts",
        "__tests__/request-security.test.ts",
        "__tests__/server.test.ts",
        "__tests__/worker.test.ts",
      ],
      // These fixtures deliberately preserve returned promises and synchronous throws.
      rules: {
        "typescript/promise-function-async": "off",
        "typescript/return-await": "off",
      },
    },
  ],
});
