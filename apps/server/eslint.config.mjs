// eslint.config.js
import { nestJsConfig } from "@kavabanga/eslint-config/nest-js";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  ...nestJsConfig,
  {
    rules: {
      "@typescript-eslint/no-extraneous-class": [
        "error",
        {
          allowConstructorOnly: true,
          allowEmpty: true,
          allowStaticOnly: true,
          allowWithDecorator: true,
        },
      ],
    },
  },
];
