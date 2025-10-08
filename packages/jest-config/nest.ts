import type { Config } from "jest";
import { config as baseConfig } from "./base";

export const config = {
  ...baseConfig,
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^src/(.*)$": "<rootDir>/src/$1",
  },
} as const satisfies Config;
