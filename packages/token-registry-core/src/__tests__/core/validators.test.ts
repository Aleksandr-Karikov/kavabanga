import {
  DefaultTokenValidator,
  StrictTokenValidator,
  NoOpValidator,
} from "../../core/validators";
import {
  TokenValidationError,
  TokenRegistryConfig,
  TokenSaveRequest,
  ITokenMeta,
} from "../../core/interfaces";

const mockConfig: TokenRegistryConfig = {
  enableValidation: true,
  defaultTtl: 30 * 24 * 60 * 60,
  enablePlugins: true,
  strictMode: false,
  operationTimeout: 5000,
};

const createValidRequest = (): TokenSaveRequest => ({
  token: "valid-token-123",
  data: {
    sub: "user123",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60000, // 1 minute from now
    meta: {
      deviceId: "device123",
      ipAddress: "192.168.1.1",
      userAgent: "Test Agent",
    },
  },
  ttl: 3600, // 1 hour
});

describe("DefaultTokenValidator", () => {
  let validator: DefaultTokenValidator;

  beforeEach(() => {
    validator = new DefaultTokenValidator(mockConfig);
  });

  describe("token validation", () => {
    it("should accept valid token", async () => {
      const request = createValidRequest();
      await expect(validator.validate(request)).resolves.not.toThrow();
    });

    it("should reject empty token", async () => {
      const request = createValidRequest();
      request.token = "";

      await expect(validator.validate(request)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject non-string token", async () => {
      const request = createValidRequest();
      (request as any).token = 123;

      await expect(validator.validate(request)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should reject token that is too short", async () => {
      const request = createValidRequest();
      request.token = "short";

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Token too short"),
        })
      );
    });

    it("should reject token that is too long", async () => {
      const request = createValidRequest();
      request.token = "a".repeat(513);

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Token too long"),
        })
      );
    });

    it("should reject token with invalid characters", async () => {
      const request = createValidRequest();
      request.token = "invalid-token-with-@-symbol";

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("invalid characters"),
        })
      );
    });
  });

  describe("token data validation", () => {
    it("should reject missing token data", async () => {
      const request = createValidRequest();
      (request as any).data = null;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Token data is required"),
        })
      );
    });

    it("should reject non-object token data", async () => {
      const request = createValidRequest();
      (request as any).data = "string";

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Token data must be an object"),
        })
      );
    });
  });

  describe("subject validation", () => {
    it("should reject missing subject", async () => {
      const request = createValidRequest();
      (request.data as any).sub = null;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Subject (sub) is required"),
        })
      );
    });

    it("should reject non-string subject", async () => {
      const request = createValidRequest();
      (request.data as any).sub = 123;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Subject must be a string"),
        })
      );
    });

    it("should reject empty subject", async () => {
      const request = createValidRequest();
      request.data.sub = "";

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Subject cannot be empty"),
        })
      );
    });

    it("should reject subject that is too long", async () => {
      const request = createValidRequest();
      request.data.sub = "a".repeat(256);

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Subject too long"),
        })
      );
    });
  });

  describe("timestamp validation", () => {
    it("should reject missing issuedAt", async () => {
      const request = createValidRequest();
      (request.data as any).issuedAt = null;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("issuedAt timestamp is required"),
        })
      );
    });

    it("should reject invalid issuedAt format", async () => {
      const request = createValidRequest();
      (request.data as any).issuedAt = "invalid";

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining(
            "issuedAt must be a positive integer"
          ),
        })
      );
    });

    it("should reject missing expiresAt", async () => {
      const request = createValidRequest();
      (request.data as any).expiresAt = null;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("expiresAt timestamp is required"),
        })
      );
    });

    it("should reject expiresAt before issuedAt", async () => {
      const request = createValidRequest();
      request.data.issuedAt = Date.now();
      request.data.expiresAt = Date.now() - 1000;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining(
            "expiresAt must be greater than issuedAt"
          ),
        })
      );
    });

    it("should reject issuedAt too far in the past", async () => {
      const request = createValidRequest();
      request.data.issuedAt = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      request.data.expiresAt = Date.now() + 60000;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("issuedAt is too far in the past"),
        })
      );
    });

    it("should reject expiresAt too far in the future", async () => {
      const request = createValidRequest();
      request.data.expiresAt = Date.now() + 366 * 24 * 60 * 60 * 1000; // 366 days

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining(
            "expiresAt is too far in the future"
          ),
        })
      );
    });
  });

  describe("meta validation", () => {
    it("should reject missing meta", async () => {
      const request = createValidRequest();
      (request.data as any).meta = null;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Meta object is required"),
        })
      );
    });

    it("should reject array as meta", async () => {
      const request = createValidRequest();
      (request.data as any).meta = [];

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Meta must be an object"),
        })
      );
    });

    it("should reject meta object that is too large", async () => {
      const request = createValidRequest();
      request.data.meta = {
        largeData: "a".repeat(2049), // Exceeds 2KB limit
      };

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Meta object too large"),
        })
      );
    });

    it("should validate deviceId if present", async () => {
      const request = createValidRequest();
      (request.data.meta as any).deviceId = 123;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("deviceId must be a string"),
        })
      );
    });

    it("should validate ipAddress if present", async () => {
      const request = createValidRequest();
      (request.data.meta as any).ipAddress = "invalid-ip";

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("Invalid IP address format"),
        })
      );
    });

    it("should accept valid IPv4 address", async () => {
      const request = createValidRequest();
      request.data.meta.ipAddress = "192.168.1.1";

      await expect(validator.validate(request)).resolves.not.toThrow();
    });

    it("should accept valid IPv6 address", async () => {
      const request = createValidRequest();
      request.data.meta.ipAddress = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";

      await expect(validator.validate(request)).resolves.not.toThrow();
    });
  });

  describe("TTL validation", () => {
    it("should reject missing TTL", async () => {
      const request = createValidRequest();
      (request as any).ttl = null;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("TTL is required"),
        })
      );
    });

    it("should reject negative TTL", async () => {
      const request = createValidRequest();
      request.ttl = -1;

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("TTL must be a positive integer"),
        })
      );
    });

    it("should reject TTL that is too large", async () => {
      const request = createValidRequest();
      request.ttl = 366 * 24 * 60 * 60; // More than 1 year

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("TTL too large"),
        })
      );
    });

    it("should reject TTL that is too small", async () => {
      const request = createValidRequest();
      request.ttl = 30; // Less than 1 minute

      await expect(validator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("TTL too small"),
        })
      );
    });
  });

  describe("strict mode validation", () => {
    it("should require deviceId or ipAddress in strict mode", async () => {
      const strictConfig = { ...mockConfig, strictMode: true };
      const strictValidator = new DefaultTokenValidator(strictConfig);

      const request = createValidRequest();
      delete request.data.meta.deviceId;
      delete request.data.meta.ipAddress;

      await expect(strictValidator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining(
            "either deviceId or ipAddress is required"
          ),
        })
      );
    });

    it("should check token entropy in strict mode", async () => {
      const strictConfig = { ...mockConfig, strictMode: true };
      const strictValidator = new DefaultTokenValidator(strictConfig);

      const request = createValidRequest();
      request.token = "aaaaaaaaaa"; // Low entropy

      await expect(strictValidator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("insufficient entropy"),
        })
      );
    });

    it("should reject future issuedAt in strict mode", async () => {
      const strictConfig = { ...mockConfig, strictMode: true };
      const strictValidator = new DefaultTokenValidator(strictConfig);

      const request = createValidRequest();
      const futureTime = Date.now() + 120000; // 2 minutes in the future
      request.data.issuedAt = futureTime;
      request.data.expiresAt = futureTime + 60000; // 1 minute after issuedAt

      await expect(strictValidator.validate(request)).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("issuedAt cannot be in the future"),
        })
      );
    });
  });
});

describe("StrictTokenValidator", () => {
  let validator: StrictTokenValidator;

  beforeEach(() => {
    validator = new StrictTokenValidator(mockConfig);
  });

  it("should require deviceId in strict mode", async () => {
    const request = createValidRequest();
    delete request.data.meta.deviceId;

    await expect(validator.validate(request)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining("deviceId is required in strict mode"),
      })
    );
  });

  it("should require ipAddress in strict mode", async () => {
    const request = createValidRequest();
    delete request.data.meta.ipAddress;

    await expect(validator.validate(request)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          "ipAddress is required in strict mode"
        ),
      })
    );
  });

  it("should require userAgent in strict mode", async () => {
    const request = createValidRequest();
    delete request.data.meta.userAgent;

    await expect(validator.validate(request)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          "userAgent is required in strict mode"
        ),
      })
    );
  });

  it("should reject short tokens in strict mode", async () => {
    const request = createValidRequest();
    request.token = "short-token-less-than-32-chars";

    await expect(validator.validate(request)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining("Token too short for strict mode"),
      })
    );
  });

  it("should reject suspicious IP addresses", async () => {
    const request = createValidRequest();
    request.token = "long-enough-token-for-strict-mode-validation-test"; // 48 chars
    request.data.meta.ipAddress = "127.0.0.1"; // localhost

    await expect(validator.validate(request)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining("Suspicious IP address detected"),
      })
    );
  });

  it("should accept valid request in strict mode", async () => {
    const request = createValidRequest();
    request.token =
      "a-very-long-and-secure-token-for-strict-mode-validation-123456789";
    request.data.meta.ipAddress = "203.0.113.1"; // Example IP, not suspicious

    await expect(validator.validate(request)).resolves.not.toThrow();
  });
});

describe("NoOpValidator", () => {
  let validator: NoOpValidator;

  beforeEach(() => {
    validator = new NoOpValidator();
  });

  it("should not validate anything", async () => {
    const invalidRequest = {
      token: "",
      data: null,
      ttl: -1,
    } as any;

    await expect(validator.validate(invalidRequest)).resolves.not.toThrow();
  });

  it("should always pass validation", async () => {
    const request = createValidRequest();
    await expect(validator.validate(request)).resolves.not.toThrow();
  });
});
