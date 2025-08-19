import {
  TokenRegistryService,
  InMemoryStore,
  DefaultTokenValidator,
  DEFAULT_CONFIG,
  TokenData,
  TokenEventHandler,
  ITokenValidator,
  TokenValidationError,
} from "../index";

describe("TokenRegistryService", () => {
  let service: TokenRegistryService;
  let store: InMemoryStore;
  let validator: DefaultTokenValidator;

  beforeEach(() => {
    store = new InMemoryStore();
    validator = new DefaultTokenValidator(DEFAULT_CONFIG);
    service = new TokenRegistryService(store, DEFAULT_CONFIG, validator);
  });

  describe("saveToken", () => {
    it("should save token successfully", async () => {
      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      const retrieved = await service.getTokenData(token);

      expect(retrieved).toEqual(data);
    });

    it("should throw validation error for invalid token", async () => {
      const token = "";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await expect(service.saveToken(token, data)).rejects.toThrow(
        TokenValidationError
      );
    });
  });

  describe("getTokenData", () => {
    it("should return null for non-existent token", async () => {
      const result = await service.getTokenData("non-existent");
      expect(result).toBeNull();
    });

    it("should return token data for existing token", async () => {
      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      const retrieved = await service.getTokenData(token);

      expect(retrieved).toEqual(data);
    });
  });

  describe("revokeToken", () => {
    it("should revoke existing token", async () => {
      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      await service.revokeToken(token);

      const retrieved = await service.getTokenData(token);
      expect(retrieved).toBeNull();
    });

    it("should throw error for non-existent token", async () => {
      await expect(service.revokeToken("non-existent")).rejects.toThrow();
    });
  });

  describe("event handlers", () => {
    it("should call event handlers on token operations", async () => {
      const events: string[] = [];

      const handler: TokenEventHandler = {
        async onTokenCreated(token: string, data: TokenData): Promise<void> {
          events.push(`created:${token}`);
        },
        async onTokenAccessed(token: string, data: TokenData): Promise<void> {
          events.push(`accessed:${token}`);
        },
        async onTokenRevoked(token: string, data: TokenData): Promise<void> {
          events.push(`revoked:${token}`);
        },
      };

      service.registerEventHandler(handler);

      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      await service.getTokenData(token);
      await service.revokeToken(token);

      expect(events).toEqual([
        "created:test-token",
        "accessed:test-token",
        "revoked:test-token",
      ]);
    });

    it("should handle multiple event handlers", async () => {
      const events: string[] = [];

      const handler1: TokenEventHandler = {
        async onTokenCreated(token: string, data: TokenData): Promise<void> {
          events.push(`handler1:${token}`);
        },
      };

      const handler2: TokenEventHandler = {
        async onTokenCreated(token: string, data: TokenData): Promise<void> {
          events.push(`handler2:${token}`);
        },
      };

      service.registerEventHandler(handler1);
      service.registerEventHandler(handler2);

      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);

      expect(events).toEqual(["handler1:test-token", "handler2:test-token"]);
    });
  });

  describe("health check", () => {
    it("should return true for healthy service", async () => {
      const isHealthy = await service.getHealthStatus();
      expect(isHealthy).toBe(true);
    });
  });

  describe("shutdown", () => {
    it("should prevent new operations after shutdown", async () => {
      await service.shutdown();

      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await expect(service.saveToken(token, data)).rejects.toThrow(
        "Service is shutting down"
      );
    });
  });
});

describe("TokenRegistryService with custom validator", () => {
  it("should use custom validator", async () => {
    const store = new InMemoryStore();

    const customValidator: ITokenValidator = {
      async validate(
        token: string,
        data: TokenData,
        ttl: number
      ): Promise<void> {
        if (data.sub === "admin") {
          throw new TokenValidationError("Admin tokens not allowed");
        }
      },
    };

    const service = new TokenRegistryService(
      store,
      DEFAULT_CONFIG,
      customValidator
    );

    const token = "admin-token";
    const data: TokenData = {
      sub: "admin",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: { deviceId: "admin-device" },
    };

    await expect(service.saveToken(token, data)).rejects.toThrow(
      "Admin tokens not allowed"
    );
  });
});
