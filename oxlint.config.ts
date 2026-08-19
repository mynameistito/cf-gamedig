import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";

export default defineConfig({
  extends: [core, antiSlop, selectJsPlugins(["github", "sonarjs"])],
  ignorePatterns: core.ignorePatterns,
  rules: {
    "anti-slop/no-unknown-parameters": "off",
    "eslint/func-names": "off",
    "eslint/max-classes-per-file": "off",
    "eslint/no-use-before-define": "off",
    "eslint/sort-keys": "off",
    "promise/prefer-await-to-callbacks": "off",
    "sonarjs/expression-complexity": "off",
    "sonarjs/max-union-size": "off",
    "sonarjs/no-hardcoded-ip": "off",
    "sonarjs/no-wildcard-import": "off",
    "typescript/no-invalid-void-type": "off",
  },
});
