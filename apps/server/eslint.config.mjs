// eslint.config.js
import { nestJsConfig } from "@repo/eslint-config/nest-js";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  ...nestJsConfig,
  // Add your custom configs here if needed
];
