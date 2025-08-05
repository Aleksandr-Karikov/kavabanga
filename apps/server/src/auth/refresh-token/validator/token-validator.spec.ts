import { Test } from "@nestjs/testing";
import { TokenValidator } from "./token-validator";
import {
  TokenValidationError,
  ConfigurationError,
} from "../refresh-token.types";

describe("TokenValidator", () => {
  let validator: TokenValidator;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [TokenValidator],
    }).compile();

    validator = module.get<TokenValidator>(TokenValidator);
  });

  describe("validateToken()", () => {
    it("throws for empty token", () => {
      expect(() => validator.validateToken("", 255)).toThrow(
        TokenValidationError
      );
    });

    it("throws for token exceeding max length", () => {
      const longToken = "x".repeat(256);
      expect(() => validator.validateToken(longToken, 255)).toThrow(
        TokenValidationError
      );
    });

    it("accepts valid token", () => {
      expect(() => validator.validateToken("valid-token", 255)).not.toThrow();
    });
  });

  describe("validateCreateTokenData()", () => {
    it("throws for missing userId", () => {
      const invalidData = { deviceId: "device-1" };
      expect(() => validator.validateCreateTokenData(invalidData)).toThrow(
        TokenValidationError
      );
    });

    it("throws for missing deviceId", () => {
      const invalidData = { userId: "user-1" };
      expect(() => validator.validateCreateTokenData(invalidData)).toThrow(
        TokenValidationError
      );
    });

    it("accepts valid data", () => {
      const validData = { userId: "user-1", deviceId: "device-1" };
      expect(() => validator.validateCreateTokenData(validData)).not.toThrow();
    });
  });

  describe("validateConfig()", () => {
    it("throws for invalid TTL", () => {
      expect(() => validator.validateConfig({ ttl: 0 })).toThrow(
        ConfigurationError
      );
      expect(() =>
        validator.validateConfig({ ttl: 366 * 24 * 60 * 60 })
      ).toThrow(ConfigurationError);
    });

    it("throws for invalid usedTokenTtl", () => {
      expect(() => validator.validateConfig({ usedTokenTtl: 0 })).toThrow(
        ConfigurationError
      );
      expect(() => validator.validateConfig({ usedTokenTtl: 61 * 60 })).toThrow(
        ConfigurationError
      );
    });

    it("accepts valid config", () => {
      const validConfig = {
        ttl: 7 * 24 * 60 * 60,
        usedTokenTtl: 5 * 60,
      };
      expect(() => validator.validateConfig(validConfig)).not.toThrow();
    });
  });

  describe("validateBatchTokens()", () => {
    it("throws for batch exceeding max size", () => {
      const tokens = Array(301).fill({
        token: "token",
        data: { userId: "user-1", deviceId: "device-1" },
      });
      expect(() => validator.validateBatchTokens(tokens, 300, 255)).toThrow(
        TokenValidationError
      );
    });

    it("filters invalid tokens", () => {
      const tokens = [
        { token: "valid", data: { userId: "user-1", deviceId: "device-1" } },
        { token: "", data: { userId: "user-1", deviceId: "device-1" } },
      ];
      const result = validator.validateBatchTokens(tokens, 300, 255);
      expect(result).toHaveLength(1);
    });
  });
});
