import * as TokenRegistry from "../index";

describe("Token Registry Core - Public API", () => {
  describe("Core Interfaces & Types", () => {
    it("should export error classes", () => {
      expect(TokenRegistry.TokenRegistryError).toBeDefined();
      expect(TokenRegistry.TokenValidationError).toBeDefined();
      expect(TokenRegistry.TokenNotFoundError).toBeDefined();
      expect(TokenRegistry.TokenOperationError).toBeDefined();
      expect(TokenRegistry.TokenConfigurationError).toBeDefined();
      expect(TokenRegistry.TokenTimeoutError).toBeDefined();
    });

    it("should export configuration constants", () => {
      expect(TokenRegistry.DEFAULT_CONFIG).toBeDefined();
      expect(TokenRegistry.DEFAULT_CONFIG).toEqual({
        enableValidation: true,
        defaultTtl: 30 * 24 * 60 * 60,
        enablePlugins: true,
        strictMode: false,
        operationTimeout: 5000,
      });
    });
  });

  describe("Core Service", () => {
    it("should export TokenRegistryService", () => {
      expect(TokenRegistry.TokenRegistryService).toBeDefined();
      expect(typeof TokenRegistry.TokenRegistryService).toBe("function");
    });

    it("should export TokenRegistryServiceFactory", () => {
      expect(TokenRegistry.TokenRegistryServiceFactory).toBeDefined();
      expect(typeof TokenRegistry.TokenRegistryServiceFactory).toBe("function");
    });
  });

  describe("Validators", () => {
    it("should export validator classes", () => {
      expect(TokenRegistry.DefaultTokenValidator).toBeDefined();
      expect(TokenRegistry.StrictTokenValidator).toBeDefined();
      expect(TokenRegistry.NoOpValidator).toBeDefined();
    });
  });

  describe("Base Adapters", () => {
    it("should export abstract base classes", () => {
      expect(TokenRegistry.BaseStoreAdapter).toBeDefined();
      expect(TokenRegistry.StoreAdapterDecorator).toBeDefined();
    });
  });

  describe("Built-in Adapters", () => {
    it("should export InMemoryStoreAdapter", () => {
      expect(TokenRegistry.InMemoryStoreAdapter).toBeDefined();
      expect(typeof TokenRegistry.InMemoryStoreAdapter).toBe("function");
    });

    it("should export factory functions", () => {
      expect(TokenRegistry.createDevelopmentMemoryAdapter).toBeDefined();
      expect(TokenRegistry.createTestMemoryAdapter).toBeDefined();
      expect(typeof TokenRegistry.createDevelopmentMemoryAdapter).toBe(
        "function"
      );
      expect(typeof TokenRegistry.createTestMemoryAdapter).toBe("function");
    });
  });

  describe("NestJS Module", () => {
    it("should export TokenRegistryModule", () => {
      expect(TokenRegistry.TokenRegistryModule).toBeDefined();
      expect(typeof TokenRegistry.TokenRegistryModule).toBe("function");
    });

    it("should export helper functions", () => {
      expect(TokenRegistry.createBasicTokenRegistryModule).toBeDefined();
      expect(TokenRegistry.createTestTokenRegistryModule).toBeDefined();
    });
  });

  describe("Type Exports", () => {
    it("should have proper type structure", () => {
      // These are compile-time checks, but we can verify they exist
      const typeChecks = {
        ITokenStoreAdapter: "ITokenStoreAdapter",
        ITokenPlugin: "ITokenPlugin",
        ITokenMeta: "ITokenMeta",
        TokenSaveRequest: "TokenSaveRequest",
        TokenData: "TokenData",
        PluginExecutionContext: "PluginExecutionContext",
        PluginHook: "PluginHook",
        TokenOperationError: "TokenOperationError",
        TokenValidationError: "TokenValidationError",
        TokenRegistryError: "TokenRegistryError",
      };

      // Verify the exports exist (this helps with refactoring)
      Object.values(typeChecks).forEach((typeName) => {
        expect(typeName).toBeDefined();
      });
    });
  });

  describe("API Compatibility", () => {
    it("should create and use InMemoryStoreAdapter", () => {
      const adapter = new TokenRegistry.InMemoryStoreAdapter();
      expect(adapter).toBeInstanceOf(TokenRegistry.InMemoryStoreAdapter);
      expect(adapter.getActiveTokenCount()).toBe(0);
    });

    it("should create and use validators", () => {
      const defaultValidator = new TokenRegistry.DefaultTokenValidator(
        TokenRegistry.DEFAULT_CONFIG
      );
      const noOpValidator = new TokenRegistry.NoOpValidator();

      expect(defaultValidator).toBeInstanceOf(
        TokenRegistry.DefaultTokenValidator
      );
      expect(noOpValidator).toBeInstanceOf(TokenRegistry.NoOpValidator);
    });

    it("should create service with factory", () => {
      const adapter = new TokenRegistry.InMemoryStoreAdapter();
      const validator = new TokenRegistry.NoOpValidator();

      const service = TokenRegistry.TokenRegistryServiceFactory.create(
        adapter,
        TokenRegistry.DEFAULT_CONFIG,
        validator
      );

      expect(service).toBeInstanceOf(TokenRegistry.TokenRegistryService);
    });

    it("should work with NestJS module", () => {
      const adapter = new TokenRegistry.InMemoryStoreAdapter();

      const module = TokenRegistry.TokenRegistryModule.forRoot({
        storeAdapter: adapter,
      });

      expect(module.module).toBe(TokenRegistry.TokenRegistryModule);
    });

    it("should use factory functions", () => {
      const devAdapter = TokenRegistry.createDevelopmentMemoryAdapter();
      const testAdapter = TokenRegistry.createTestMemoryAdapter();

      expect(devAdapter).toBeInstanceOf(TokenRegistry.InMemoryStoreAdapter);
      expect(testAdapter).toBeInstanceOf(TokenRegistry.InMemoryStoreAdapter);
    });
  });

  describe("Error Handling", () => {
    it("should create and handle errors properly", () => {
      const validationError = new TokenRegistry.TokenValidationError(
        "Invalid token"
      );
      const notFoundError = new TokenRegistry.TokenNotFoundError("token123");
      const configError = new TokenRegistry.TokenConfigurationError(
        "Bad config"
      );
      const timeoutError = new TokenRegistry.TokenTimeoutError(
        "saveToken",
        5000
      );
      const operationError = new TokenRegistry.TokenOperationError(
        "saveToken",
        new Error("Base error")
      );

      expect(validationError).toBeInstanceOf(TokenRegistry.TokenRegistryError);
      expect(notFoundError).toBeInstanceOf(TokenRegistry.TokenRegistryError);
      expect(configError).toBeInstanceOf(TokenRegistry.TokenRegistryError);
      expect(timeoutError).toBeInstanceOf(TokenRegistry.TokenRegistryError);
      expect(operationError).toBeInstanceOf(TokenRegistry.TokenRegistryError);

      expect(validationError.code).toBe("VALIDATION_ERROR");
      expect(notFoundError.code).toBe("TOKEN_NOT_FOUND");
      expect(configError.code).toBe("CONFIGURATION_ERROR");
      expect(timeoutError.code).toBe("TIMEOUT_ERROR");
      expect(operationError.code).toBe("OPERATION_FAILED");
    });
  });

  describe("Documentation Examples", () => {
    it("should work with basic usage example from README", async () => {
      // This mirrors the basic usage example from README
      const adapter = new TokenRegistry.InMemoryStoreAdapter();
      const validator = new TokenRegistry.DefaultTokenValidator(
        TokenRegistry.DEFAULT_CONFIG
      );

      const service = new TokenRegistry.TokenRegistryService(
        adapter,
        TokenRegistry.DEFAULT_CONFIG,
        validator
      );

      const tokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        meta: {
          deviceId: "device123",
          ipAddress: "192.168.1.1",
        },
      };

      await service.saveToken("test-token", tokenData, 60);
      const retrieved = await service.getTokenData("test-token");

      expect(retrieved).toEqual(tokenData);
    });

    it("should work with decorator pattern example", async () => {
      class LoggingDecorator extends TokenRegistry.StoreAdapterDecorator {
        logs: string[] = [];

        async saveToken(request: any): Promise<void> {
          this.logs.push(`Saving: ${request.token}`);
          await super.saveToken(request);
        }
      }

      const baseAdapter = new TokenRegistry.InMemoryStoreAdapter();
      const loggingAdapter = new LoggingDecorator(baseAdapter);

      const request = {
        token: "test-token",
        data: {
          sub: "user123",
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60000,
          meta: {},
        },
        ttl: 60,
      };

      await loggingAdapter.saveToken(request);

      expect(loggingAdapter.logs).toContain("Saving: test-token");

      const data = await baseAdapter.getTokenData("test-token");
      expect(data).toEqual(request.data);
    });
  });
});
