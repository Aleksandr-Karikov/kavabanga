import {
  DefaultTokenValidator,
  NoOpValidator,
  DEFAULT_CONFIG,
  TokenData,
  TokenValidationError,
} from "../index";

describe("DefaultTokenValidator", () => {
  let validator: DefaultTokenValidator;

  beforeEach(() => {
    validator = new DefaultTokenValidator(DEFAULT_CONFIG);
  });

  describe("validate", () => {
    it("should validate correct token data", async () => {
      const token = "valid-token-123";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: {
          deviceId: "device123",
          ipAddress: "192.168.1.1",
        },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).resolves.not.toThrow();
    });

    it("should reject empty token", async () => {
      const token = "";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject token that is too short", async () => {
      const token = "short";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject token that is too long", async () => {
      const token = "a".repeat(513);
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject empty subject", async () => {
      const token = "valid-token";
      const data: TokenData = {
        sub: "",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject invalid timestamps", async () => {
      const token = "valid-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: 0,
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject when expiresAt <= issuedAt", async () => {
      const token = "valid-token";
      const now = Date.now();
      const data: TokenData = {
        sub: "user123",
        issuedAt: now,
        expiresAt: now,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject invalid TTL", async () => {
      const token = "valid-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 0;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject TTL that is too large", async () => {
      const token = "valid-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 365 * 24 * 60 * 60 + 1; // More than 1 year

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should validate meta fields correctly", async () => {
      const token = "valid-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: {
          deviceId: "device123",
          ipAddress: "192.168.1.1",
          userAgent: "Mozilla/5.0",
          fingerprint: "abc123",
        },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).resolves.not.toThrow();
    });

    it("should reject invalid IP address", async () => {
      const token = "valid-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: {
          deviceId: "device123",
          ipAddress: "invalid-ip",
        },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject meta object that is too large", async () => {
      const token = "valid-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: {
          deviceId: "device123",
          largeField: "x".repeat(3000), // This will make meta > 2KB
        },
      };
      const ttl = 3600;

      await expect(validator.validate(token, data, ttl)).rejects.toThrow(
        TokenValidationError
      );
    });
  });
});

describe("NoOpValidator", () => {
  let validator: NoOpValidator;

  beforeEach(() => {
    validator = new NoOpValidator();
  });

  it("should not throw for any input", async () => {
    const token = "any-token";
    const data: TokenData = {
      sub: "any-subject",
      issuedAt: 0,
      expiresAt: 0,
      meta: {},
    };
    const ttl = 0;

    await expect(validator.validate(token, data, ttl)).resolves.not.toThrow();
  });
});
