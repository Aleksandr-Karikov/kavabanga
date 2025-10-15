import {
  TokenRegistryService,
  InMemoryStore,
  DefaultTokenValidator,
  DEFAULT_CONFIG,
  TokenData,
  TokenEventHandler,
  ITokenValidator,
  TokenValidationError,
  TokenNotFoundError,
  TokenOperationError,
  TokenExpiredError,
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

  afterEach(() => {
    store.clear();
  });

  describe("saveToken", () => {
    it("should save token successfully", async () => {
      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      const retrieved = await service.getTokenData(token);

      expect(retrieved).toBeDefined();
      expect(retrieved!.sub).toBe("user123");
      expect(retrieved!.meta.deviceId).toBe("device123");
      expect(retrieved!.issuedAt).toBeDefined();
      expect(retrieved!.expiresAt).toBeDefined();
    });

    it("should throw validation error for invalid token", async () => {
      const token = "short"; // Меньше 8 символов
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await expect(service.saveToken(token, data)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should throw validation error for empty token", async () => {
      const token = "";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await expect(service.saveToken(token, data)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should auto-generate timestamps if not provided", async () => {
      const token = "test-token-12345678";
      const beforeSave = Date.now();

      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data, 3600);

      const afterSave = Date.now();
      const retrieved = await service.getTokenData(token);

      expect(retrieved).toBeDefined();
      expect(retrieved!.issuedAt).toBeGreaterThanOrEqual(beforeSave);
      expect(retrieved!.issuedAt).toBeLessThanOrEqual(afterSave);
      expect(retrieved!.expiresAt).toBeGreaterThan(retrieved!.issuedAt);
    });

    it("should use provided timestamps", async () => {
      const token = "test-token-12345678";
      const issuedAt = Date.now();
      const expiresAt = issuedAt + 3600000;

      const data = {
        sub: "user123",
        issuedAt,
        expiresAt,
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      const retrieved = await service.getTokenData(token);

      expect(retrieved!.issuedAt).toBe(issuedAt);
      expect(retrieved!.expiresAt).toBe(expiresAt);
    });
  });

  describe("getTokenData", () => {
    it("should return null for non-existent token", async () => {
      const result = await service.getTokenData("non-existent");
      expect(result).toBeNull();
    });

    it("should return token data for existing token", async () => {
      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      const retrieved = await service.getTokenData(token);

      expect(retrieved).toBeDefined();
      expect(retrieved!.sub).toBe("user123");
    });
  });

  describe("revokeToken", () => {
    it("should revoke existing token", async () => {
      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      await service.revokeToken(token);

      const retrieved = await service.getTokenData(token);
      expect(retrieved).toBeNull();
    });

    it("should throw TokenNotFoundError for non-existent token", async () => {
      await expect(service.revokeToken("non-existent-token")).rejects.toThrow(
        TokenNotFoundError
      );
    });
  });

  describe("rotateToken", () => {
    it("should rotate token successfully", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";

      const oldData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-old" },
      };

      const newData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-new" },
      };

      await service.saveToken(oldToken, oldData);
      await service.rotateToken(oldToken, newToken, newData);

      const oldResult = await service.getTokenData(oldToken);
      const newResult = await service.getTokenData(newToken);

      expect(oldResult).toBeNull();
      expect(newResult).toBeDefined();
      expect(newResult!.sub).toBe("user123");
      expect(newResult!.meta.deviceId).toBe("device-new");
    });

    it("should throw TokenNotFoundError if old token does not exist", async () => {
      const oldToken = "non-existent-old";
      const newToken = "new-token-87654321";
      const newData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-new" },
      };

      await expect(
        service.rotateToken(oldToken, newToken, newData)
      ).rejects.toThrow(TokenNotFoundError);
    });

    it("should throw ValidationError if tokens are the same", async () => {
      const token = "same-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);

      await expect(service.rotateToken(token, token, data)).rejects.toThrow(
        TokenValidationError
      );

      await expect(service.rotateToken(token, token, data)).rejects.toThrow(
        "New token must be different from old token"
      );
    });
    it("should throw TokenExpiredError if trying to rotate expired token", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";

      const expiredData = {
        sub: "user123",
        issuedAt: Date.now() - 10000,
        expiresAt: Date.now() - 5000,
        meta: { deviceId: "device-old" },
      };

      await service.saveToken(oldToken, expiredData);

      const newData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-new" },
      };

      await expect(
        service.rotateToken(oldToken, newToken, newData)
      ).rejects.toThrow(TokenExpiredError);

      await expect(
        service.rotateToken(oldToken, newToken, newData)
      ).rejects.toThrow("Cannot operate on expired token");

      try {
        await service.rotateToken(oldToken, newToken, newData);
      } catch (error) {
        expect(error).toBeInstanceOf(TokenExpiredError);
        expect((error as TokenExpiredError).isCritical).toBe(false);
        expect((error as TokenExpiredError).code).toBe("TOKEN_EXPIRED");
      }
    });

    it("should validate new token format", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "short";

      const oldData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-old" },
      };

      const newData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-new" },
      };

      await service.saveToken(oldToken, oldData);

      await expect(
        service.rotateToken(oldToken, newToken, newData)
      ).rejects.toThrow(TokenValidationError);
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

      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      await service.getTokenData(token);
      await service.revokeToken(token);

      expect(events).toEqual([
        "created:test-token-12345678",
        "accessed:test-token-12345678",
        "revoked:test-token-12345678",
      ]);
    });

    it("should call event handlers on token rotation", async () => {
      const events: string[] = [];

      const handler: TokenEventHandler = {
        async onTokenCreated(token: string, data: TokenData): Promise<void> {
          events.push(`created:${token}`);
        },
        async onTokenRevoked(token: string, data: TokenData): Promise<void> {
          events.push(`revoked:${token}`);
        },
      };

      service.registerEventHandler(handler);

      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";

      const oldData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-old" },
      };

      const newData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-new" },
      };
      await service.saveToken(oldToken, oldData);
      events.length = 0;

      await service.rotateToken(oldToken, newToken, newData);

      expect(events).toEqual([
        "revoked:old-token-12345678",
        "created:new-token-87654321",
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

      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);

      expect(events).toEqual([
        "handler1:test-token-12345678",
        "handler2:test-token-12345678",
      ]);
    });

    it("should not fail if event handler throws error", async () => {
      const events: string[] = [];

      const handler: TokenEventHandler = {
        async onTokenCreated(token: string, data: TokenData): Promise<void> {
          events.push(`created:${token}`);
          throw new Error("Handler error");
        },
      };

      service.registerEventHandler(handler);

      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await expect(service.saveToken(token, data)).resolves.not.toThrow();

      expect(events).toContain("created:test-token-12345678");

      const retrieved = await service.getTokenData(token);
      expect(retrieved).toBeDefined();
    });

    it("should unregister event handler", async () => {
      const events: string[] = [];

      const handler: TokenEventHandler = {
        async onTokenCreated(token: string, data: TokenData): Promise<void> {
          events.push(`created:${token}`);
        },
      };

      service.registerEventHandler(handler);
      service.unregisterEventHandler(handler);

      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);

      expect(events).toEqual([]);
    });

    it("should return registered event handlers", () => {
      const handler1: TokenEventHandler = {
        async onTokenCreated(): Promise<void> {},
      };

      const handler2: TokenEventHandler = {
        async onTokenRevoked(): Promise<void> {},
      };

      service.registerEventHandler(handler1);
      service.registerEventHandler(handler2);

      const handlers = service.getRegisteredEventHandlers();
      expect(handlers).toHaveLength(2);
      expect(handlers).toContain(handler1);
      expect(handlers).toContain(handler2);
    });
  });

  describe("health check", () => {
    it("should return true for healthy service", async () => {
      const isHealthy = await service.getHealthStatus();
      expect(isHealthy).toBe(true);
    });

    it("should return false if store is unhealthy", async () => {
      jest.spyOn(store, "health").mockResolvedValue(false);

      const isHealthy = await service.getHealthStatus();
      expect(isHealthy).toBe(false);
    });

    it("should return false if health check throws error", async () => {
      jest
        .spyOn(store, "health")
        .mockRejectedValue(new Error("Health check failed"));

      const isHealthy = await service.getHealthStatus();
      expect(isHealthy).toBe(false);
    });
  });

  describe("shutdown", () => {
    it("should prevent new operations after shutdown", async () => {
      await service.shutdown();

      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await expect(service.saveToken(token, data)).rejects.toThrow(
        TokenOperationError
      );

      await expect(service.saveToken(token, data)).rejects.toThrow(
        "Service is shutting down"
      );
    });

    it("should prevent getTokenData after shutdown", async () => {
      await service.shutdown();

      await expect(service.getTokenData("any-token")).rejects.toThrow(
        TokenOperationError
      );
    });

    it("should prevent revokeToken after shutdown", async () => {
      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await service.saveToken(token, data);
      await service.shutdown();

      await expect(service.revokeToken(token)).rejects.toThrow(
        TokenOperationError
      );
    });

    it("should prevent rotateToken after shutdown", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";

      const oldData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-old" },
      };

      const newData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device-new" },
      };

      await service.saveToken(oldToken, oldData);
      await service.shutdown();

      await expect(
        service.rotateToken(oldToken, newToken, newData)
      ).rejects.toThrow(TokenOperationError);
    });
  });

  describe("configuration", () => {
    it("should skip validation when disabled", async () => {
      const configWithoutValidation = {
        ...DEFAULT_CONFIG,
        enableValidation: false,
      };

      const serviceWithoutValidation = new TokenRegistryService(
        store,
        configWithoutValidation,
        validator
      );

      const token = "short"; // Невалидный токен
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      // Не должно выбросить ошибку валидации
      await expect(
        serviceWithoutValidation.saveToken(token, data)
      ).resolves.not.toThrow();
    });

    it("should skip events when disabled", async () => {
      const configWithoutEvents = {
        ...DEFAULT_CONFIG,
        enableEvents: false,
      };

      const serviceWithoutEvents = new TokenRegistryService(
        store,
        configWithoutEvents,
        validator
      );

      const events: string[] = [];
      const handler: TokenEventHandler = {
        async onTokenCreated(token: string): Promise<void> {
          events.push(`created:${token}`);
        },
      };

      serviceWithoutEvents.registerEventHandler(handler);

      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await serviceWithoutEvents.saveToken(token, data);

      expect(events).toEqual([]);
    });

    it("should use custom default TTL", async () => {
      const customConfig = {
        ...DEFAULT_CONFIG,
        defaultTtl: 7200, // 2 hours
      };

      const serviceWithCustomTTL = new TokenRegistryService(
        store,
        customConfig,
        validator
      );

      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await serviceWithCustomTTL.saveToken(token, data);
      const retrieved = await serviceWithCustomTTL.getTokenData(token);

      expect(retrieved).toBeDefined();

      const expectedExpiresAt = retrieved!.issuedAt + 7200 * 1000;
      expect(retrieved!.expiresAt).toBeCloseTo(expectedExpiresAt, -2);
    });

    it("should apply operation timeout", async () => {
      const configWithTimeout = {
        ...DEFAULT_CONFIG,
        operationTimeout: 100, // 100ms
      };

      jest.spyOn(store, "save").mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200)); // 200ms
      });

      const serviceWithTimeout = new TokenRegistryService(
        store,
        configWithTimeout,
        validator
      );

      const token = "test-token-12345678";
      const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
        sub: "user123",
        meta: { deviceId: "device123" },
      };

      await expect(serviceWithTimeout.saveToken(token, data)).rejects.toThrow(
        "timed out"
      );
    }, 10000);
  });

  describe("getStore and getConfig", () => {
    it("should return store instance", () => {
      const returnedStore = service.getStore();
      expect(returnedStore).toBe(store);
    });

    it("should return config", () => {
      const returnedConfig = service.getConfig();
      expect(returnedConfig).toBe(DEFAULT_CONFIG);
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

    const token = "admin-token-12345678";
    const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "admin",
      meta: { deviceId: "admin-device" },
    };

    await expect(service.saveToken(token, data)).rejects.toThrow(
      "Admin tokens not allowed"
    );
  });

  it("should allow custom business rules in validator", async () => {
    const store = new InMemoryStore();

    const customValidator: ITokenValidator = {
      async validate(
        token: string,
        data: TokenData,
        ttl: number
      ): Promise<void> {
        const allowedDevices = ["device-1", "device-2", "device-3"];

        if (
          data.meta.deviceId &&
          !allowedDevices.includes(data.meta.deviceId as string)
        ) {
          throw new TokenValidationError("Device not allowed", {
            deviceId: data.meta.deviceId,
          });
        }
      },
    };

    const service = new TokenRegistryService(
      store,
      DEFAULT_CONFIG,
      customValidator
    );

    const token = "test-token-12345678";

    const validData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device-1" },
    };

    await expect(service.saveToken(token, validData)).resolves.not.toThrow();

    const invalidData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device-unknown" },
    };

    await expect(
      service.saveToken("another-token-87654321", invalidData)
    ).rejects.toThrow("Device not allowed");
  });
});

describe("TokenRegistryService error handling", () => {
  let service: TokenRegistryService;
  let store: InMemoryStore;
  let validator: DefaultTokenValidator;

  beforeEach(() => {
    store = new InMemoryStore();
    validator = new DefaultTokenValidator(DEFAULT_CONFIG);
    service = new TokenRegistryService(store, DEFAULT_CONFIG, validator);
  });

  afterEach(() => {
    store.clear();
  });

  it("should wrap store errors in TokenOperationError", async () => {
    jest.spyOn(store, "save").mockRejectedValue(new Error("Storage failure"));

    const token = "test-token-12345678";
    const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device123" },
    };

    await expect(service.saveToken(token, data)).rejects.toThrow(
      TokenOperationError
    );
  });

  it("should preserve TokenRegistryError subclasses", async () => {
    const token = "test-token-12345678";
    const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device123" },
    };

    await service.saveToken(token, data);

    await service.revokeToken(token);

    try {
      await service.revokeToken(token);
      fail("Should have thrown TokenNotFoundError");
    } catch (error) {
      expect(error).toBeInstanceOf(TokenNotFoundError);
      expect((error as TokenNotFoundError).code).toBe("TOKEN_NOT_FOUND");
    }
  });

  it("should include context in wrapped errors", async () => {
    jest.spyOn(store, "save").mockRejectedValue(new Error("Storage failure"));

    const token = "test-token-12345678";
    const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device123" },
    };

    try {
      await service.saveToken(token, data);
      fail("Should have thrown error");
    } catch (error) {
      expect(error).toBeInstanceOf(TokenOperationError);
      const opError = error as TokenOperationError;
      expect(opError.context).toBeDefined();
      expect(opError.context?.originalError).toBe("Storage failure");
    }
  });
});

describe("TokenRegistryService integration scenarios", () => {
  let service: TokenRegistryService;
  let store: InMemoryStore;
  let validator: DefaultTokenValidator;

  beforeEach(() => {
    store = new InMemoryStore();
    validator = new DefaultTokenValidator(DEFAULT_CONFIG);
    service = new TokenRegistryService(store, DEFAULT_CONFIG, validator);
  });

  afterEach(() => {
    store.clear();
  });

  it("should handle complete token lifecycle", async () => {
    const events: string[] = [];
    const handler: TokenEventHandler = {
      async onTokenCreated(token: string): Promise<void> {
        events.push(`created:${token}`);
      },
      async onTokenAccessed(token: string): Promise<void> {
        events.push(`accessed:${token}`);
      },
      async onTokenRevoked(token: string): Promise<void> {
        events.push(`revoked:${token}`);
      },
    };

    service.registerEventHandler(handler);

    // 1. Create token
    const token = "lifecycle-token-12345678";
    const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device123" },
    };

    await service.saveToken(token, data);
    expect(events).toContain("created:lifecycle-token-12345678");

    // 2. Access token
    const retrieved = await service.getTokenData(token);
    expect(retrieved).toBeDefined();
    expect(events).toContain("accessed:lifecycle-token-12345678");

    // 3. Revoke token
    await service.revokeToken(token);
    expect(events).toContain("revoked:lifecycle-token-12345678");

    // 4. Verify token is gone
    const afterRevoke = await service.getTokenData(token);
    expect(afterRevoke).toBeNull();
  });

  it("should handle token rotation with proper cleanup", async () => {
    const oldToken = "old-lifecycle-token-12345";
    const newToken = "new-lifecycle-token-67890";

    const oldData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device-old", sessionId: "session-1" },
    };

    const newData: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device-new", sessionId: "session-2" },
    };

    await service.saveToken(oldToken, oldData);

    let retrieved = await service.getTokenData(oldToken);
    expect(retrieved).toBeDefined();
    expect(retrieved!.meta.sessionId).toBe("session-1");

    await service.rotateToken(oldToken, newToken, newData);

    const oldResult = await service.getTokenData(oldToken);
    expect(oldResult).toBeNull();

    const newResult = await service.getTokenData(newToken);
    expect(newResult).toBeDefined();
    expect(newResult!.meta.sessionId).toBe("session-2");

    expect(store.getActiveTokenCount()).toBe(1);
    expect(store.getActiveTokens()).toEqual([newToken]);
  });

  it("should handle concurrent operations gracefully", async () => {
    const tokens = Array.from(
      { length: 10 },
      (_, i) => `concurrent-token-${i}-${Date.now()}`
    );

    const data: Omit<TokenData, "issuedAt" | "expiresAt"> = {
      sub: "user123",
      meta: { deviceId: "device123" },
    };

    await Promise.all(tokens.map((token) => service.saveToken(token, data)));

    const results = await Promise.all(
      tokens.map((token) => service.getTokenData(token))
    );

    expect(results.every((r) => r !== null)).toBe(true);
    expect(store.getActiveTokenCount()).toBe(10);

    await Promise.all(tokens.map((token) => service.revokeToken(token)));

    expect(store.getActiveTokenCount()).toBe(0);
  });
});
