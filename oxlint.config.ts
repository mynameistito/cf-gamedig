import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";

export default defineConfig({
  extends: [core, antiSlop, selectJsPlugins(["github", "sonarjs"])],
  ignorePatterns: core.ignorePatterns,
});
