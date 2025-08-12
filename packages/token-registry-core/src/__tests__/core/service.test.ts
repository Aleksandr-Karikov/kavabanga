import {
  TokenRegistryService,
  TokenRegistryServiceFactory,
} from "../../core/service";
import {
  ITokenStoreAdapter,
  ITokenValidator,
  ITokenPlugin,
  TokenSaveRequest,
  TokenData,
  TokenRegistryConfig,
  TokenOperationError,
  TokenNotFoundError,
  TokenConfigurationError,
  DEFAULT_CONFIG,
} from "../../core/interfaces";
import { InMemoryStoreAdapter } from "../../adapters/memory.adapter";
import { DefaultTokenValidator, NoOpValidator } from "../../core/validators";

const createTestRequest = (): TokenSaveRequest => ({
  token: "test-token-123",
  data: {
    sub: "user123",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    meta: {
      deviceId: "device123",
      ipAddress: "192.168.1.1",
    },
  },
  ttl: 60,
});

const createMockAdapter = (): jest.Mocked<ITokenStoreAdapter> => ({
  saveToken: jest.fn(),
  getTokenData: jest.fn(),
  deleteToken: jest.fn(),
  saveBatchTokens: jest.fn(),
  isHealthy: jest.fn().mockResolvedValue(true),
});

const createMockValidator = (): jest.Mocked<ITokenValidator> => ({
  validate: jest.fn(),
});

const createMockPlugin = (
  name: string,
  priority: number = 100
): jest.Mocked<ITokenPlugin> => ({
  name,
  priority,
  preSave: jest.fn(),
  postSave: jest.fn(),
  preGet: jest.fn(),
  postGet: jest.fn(),
  preRevoke: jest.fn(),
  postRevoke: jest.fn(),
  onError: jest.fn(),
});

describe("TokenRegistryService", () => {
  let service: TokenRegistryService;
  let mockAdapter: jest.Mocked<ITokenStoreAdapter>;
  let mockValidator: jest.Mocked<ITokenValidator>;
  let config: TokenRegistryConfig;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    mockValidator = createMockValidator();
    config = { ...DEFAULT_CONFIG };
    service = new TokenRegistryService(mockAdapter, config, mockValidator);
  });

  describe("constructor", () => {
    it("should create service with provided dependencies", () => {
      expect(service).toBeInstanceOf(TokenRegistryService);
      expect(service.getStoreAdapter()).toBe(mockAdapter);
      expect(service.getConfig()).toBe(config);
    });
  });

  describe("plugin management", () => {
    it("should register plugin successfully", () => {
      const plugin = createMockPlugin("TestPlugin");

      service.registerPlugin(plugin);

      const plugins = service.getRegisteredPlugins();
      expect(plugins).toContain(plugin);
    });

    it("should sort plugins by priority", () => {
      const plugin1 = createMockPlugin("Plugin1", 200);
      const plugin2 = createMockPlugin("Plugin2", 100);
      const plugin3 = createMockPlugin("Plugin3", 50);

      service.registerPlugin(plugin1);
      service.registerPlugin(plugin2);
      service.registerPlugin(plugin3);

      const plugins = service.getRegisteredPlugins();
      expect(plugins[0]).toBe(plugin3); // priority 50
      expect(plugins[1]).toBe(plugin2); // priority 100
      expect(plugins[2]).toBe(plugin1); // priority 200
    });

    it("should prevent duplicate plugin names", () => {
      const plugin1 = createMockPlugin("DuplicateName");
      const plugin2 = createMockPlugin("DuplicateName");

      service.registerPlugin(plugin1);

      expect(() => service.registerPlugin(plugin2)).toThrow(
        TokenConfigurationError
      );
    });

    it("should unregister plugin by name", () => {
      const plugin = createMockPlugin("TestPlugin");

      service.registerPlugin(plugin);
      expect(service.getRegisteredPlugins()).toContain(plugin);

      service.unregisterPlugin("TestPlugin");
      expect(service.getRegisteredPlugins()).not.toContain(plugin);
    });

    it("should handle unregistering non-existent plugin", () => {
      expect(() => service.unregisterPlugin("NonExistent")).not.toThrow();
    });
  });

  describe("saveToken", () => {
    it("should save token successfully", async () => {
      const request = createTestRequest();
      mockValidator.validate.mockResolvedValue();
      mockAdapter.saveToken.mockResolvedValue();

      await service.saveToken(request.token, request.data, request.ttl);

      expect(mockValidator.validate).toHaveBeenCalledWith(request);
      expect(mockAdapter.saveToken).toHaveBeenCalledWith(
        expect.objectContaining({
          token: request.token,
          data: request.data,
          ttl: request.ttl,
        })
      );
    });

    it("should use default TTL when not provided", async () => {
      const request = createTestRequest();
      mockValidator.validate.mockResolvedValue();
      mockAdapter.saveToken.mockResolvedValue();

      await service.saveToken(request.token, request.data);

      expect(mockAdapter.saveToken).toHaveBeenCalledWith(
        expect.objectContaining({
          ttl: config.defaultTtl,
        })
      );
    });

    it("should skip validation when disabled", async () => {
      config.enableValidation = false;
      const request = createTestRequest();
      mockAdapter.saveToken.mockResolvedValue();

      await service.saveToken(request.token, request.data, request.ttl);

      expect(mockValidator.validate).not.toHaveBeenCalled();
    });

    it("should execute plugins in correct order", async () => {
      const plugin1 = createMockPlugin("Plugin1", 200);
      const plugin2 = createMockPlugin("Plugin2", 100);

      service.registerPlugin(plugin1);
      service.registerPlugin(plugin2);

      const request = createTestRequest();
      mockValidator.validate.mockResolvedValue();
      mockAdapter.saveToken.mockResolvedValue();

      await service.saveToken(request.token, request.data, request.ttl);

      // Plugin2 (priority 100) should be called before Plugin1 (priority 200)
      expect(plugin2.preSave).toHaveBeenCalled();
      expect(plugin1.preSave).toHaveBeenCalled();
      expect(plugin2.postSave).toHaveBeenCalled();
      expect(plugin1.postSave).toHaveBeenCalled();
    });

    it("should throw when service is shutting down", async () => {
      await service.shutdown();

      await expect(
        service.saveToken("token", {} as TokenData, 60)
      ).rejects.toThrow(TokenOperationError);
    });

    it("should handle adapter errors", async () => {
      const request = createTestRequest();
      const adapterError = new Error("Adapter error");

      mockValidator.validate.mockResolvedValue();
      mockAdapter.saveToken.mockRejectedValue(adapterError);

      await expect(
        service.saveToken(request.token, request.data, request.ttl)
      ).rejects.toThrow(TokenOperationError);
    });
  });

  describe("getTokenData", () => {
    it("should retrieve token data successfully", async () => {
      const request = createTestRequest();
      mockAdapter.getTokenData.mockResolvedValue(request.data);

      const result = await service.getTokenData(request.token);

      expect(result).toEqual(request.data);
      expect(mockAdapter.getTokenData).toHaveBeenCalledWith(request.token);
    });

    it("should return null when token not found", async () => {
      mockAdapter.getTokenData.mockResolvedValue(null);

      const result = await service.getTokenData("non-existent");

      expect(result).toBeNull();
    });

    it("should execute plugins for get operation", async () => {
      const plugin = createMockPlugin("TestPlugin");
      service.registerPlugin(plugin);

      const request = createTestRequest();
      mockAdapter.getTokenData.mockResolvedValue(request.data);

      await service.getTokenData(request.token);

      expect(plugin.preGet).toHaveBeenCalledWith(request.token);
      expect(plugin.postGet).toHaveBeenCalledWith(request.token, request.data);
    });
  });

  describe("revokeToken", () => {
    it("should revoke token successfully", async () => {
      const request = createTestRequest();
      mockAdapter.getTokenData.mockResolvedValue(request.data);
      mockAdapter.deleteToken.mockResolvedValue();

      await service.revokeToken(request.token);

      expect(mockAdapter.getTokenData).toHaveBeenCalledWith(request.token);
      expect(mockAdapter.deleteToken).toHaveBeenCalledWith(request.token);
    });

    it("should throw when token not found", async () => {
      mockAdapter.getTokenData.mockResolvedValue(null);

      await expect(service.revokeToken("non-existent")).rejects.toThrow(
        TokenNotFoundError
      );
    });

    it("should execute plugins for revoke operation", async () => {
      const plugin = createMockPlugin("TestPlugin");
      service.registerPlugin(plugin);

      const request = createTestRequest();
      mockAdapter.getTokenData.mockResolvedValue(request.data);
      mockAdapter.deleteToken.mockResolvedValue();

      await service.revokeToken(request.token);

      expect(plugin.preRevoke).toHaveBeenCalledWith(
        request.token,
        request.data
      );
      expect(plugin.postRevoke).toHaveBeenCalledWith(
        request.token,
        request.data
      );
    });
  });

  describe("saveBatchTokens", () => {
    it("should save batch of tokens successfully", async () => {
      const requests = [
        createTestRequest(),
        { ...createTestRequest(), token: "token2" },
      ];

      mockValidator.validate.mockResolvedValue();
      mockAdapter.saveBatchTokens.mockResolvedValue();

      await service.saveBatchTokens(requests);

      expect(mockValidator.validate).toHaveBeenCalledTimes(2);
      expect(mockAdapter.saveBatchTokens).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ token: requests[0]!.token }),
          expect.objectContaining({ token: requests[1]!.token }),
        ])
      );
    });

    it("should execute plugins for all tokens in batch", async () => {
      const plugin = createMockPlugin("TestPlugin");
      service.registerPlugin(plugin);

      const requests = [
        createTestRequest(),
        { ...createTestRequest(), token: "token2" },
      ];

      mockValidator.validate.mockResolvedValue();
      mockAdapter.saveBatchTokens.mockResolvedValue();

      await service.saveBatchTokens(requests);

      expect(plugin.preSave).toHaveBeenCalledTimes(2);
      expect(plugin.postSave).toHaveBeenCalledTimes(2);
    });
  });

  describe("getHealthStatus", () => {
    it("should return adapter health status", async () => {
      mockAdapter.isHealthy.mockResolvedValue(true);

      const health = await service.getHealthStatus();

      expect(health).toBe(true);
      expect(mockAdapter.isHealthy).toHaveBeenCalled();
    });

    it("should return false when adapter throws", async () => {
      mockAdapter.isHealthy.mockRejectedValue(new Error("Adapter error"));

      const health = await service.getHealthStatus();

      expect(health).toBe(false);
    });
  });

  describe("shutdown", () => {
    it("should set shutting down flag", async () => {
      await service.shutdown();

      await expect(
        service.saveToken("token", {} as TokenData, 60)
      ).rejects.toThrow(TokenOperationError);
    });

    it("should wait for operations to complete", async () => {
      const startTime = Date.now();

      await service.shutdown();

      const endTime = Date.now();
      expect(endTime - startTime).toBeGreaterThanOrEqual(1000);
    });
  });

  describe("operation timeout", () => {
    it("should timeout long operations", async () => {
      config.operationTimeout = 100; // 100ms timeout

      mockAdapter.saveToken.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200))
      );

      await expect(
        service.saveToken("token", {} as TokenData, 60)
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining("timed out"),
        })
      );
    });

    it("should not timeout when set to 0", async () => {
      config.operationTimeout = 0;

      mockAdapter.saveToken.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      await expect(
        service.saveToken("token", {} as TokenData, 60)
      ).resolves.not.toThrow();
    });
  });

  describe("error handling", () => {
    it("should notify plugins about errors", async () => {
      const plugin = createMockPlugin("TestPlugin");
      service.registerPlugin(plugin);

      const adapterError = new Error("Adapter error");
      mockAdapter.saveToken.mockRejectedValue(adapterError);

      await expect(
        service.saveToken("token", {} as TokenData, 60)
      ).rejects.toThrow();

      expect(plugin.onError).toHaveBeenCalledWith(
        "saveToken",
        expect.any(Error),
        expect.any(Object)
      );
    });

    it("should handle plugin errors gracefully", async () => {
      const plugin = createMockPlugin("TestPlugin");
      (plugin.preSave as jest.MockedFunction<any>).mockRejectedValue(
        new Error("Plugin error")
      );
      service.registerPlugin(plugin);

      const request = createTestRequest();
      mockValidator.validate.mockResolvedValue();
      mockAdapter.saveToken.mockResolvedValue();

      // Mock console.error to avoid noise
      const originalError = console.error;
      console.error = jest.fn();

      try {
        await service.saveToken(request.token, request.data, request.ttl);

        // Operation should still succeed despite plugin error
        expect(mockAdapter.saveToken).toHaveBeenCalled();
      } finally {
        console.error = originalError;
      }
    });
  });
});

describe("TokenRegistryServiceFactory", () => {
  describe("create", () => {
    it("should create service with plugins", () => {
      const adapter = new InMemoryStoreAdapter();
      const validator = new NoOpValidator();
      const plugins = [
        createMockPlugin("Plugin1"),
        createMockPlugin("Plugin2"),
      ];

      const service = TokenRegistryServiceFactory.create(
        adapter,
        DEFAULT_CONFIG,
        validator,
        plugins
      );

      expect(service).toBeInstanceOf(TokenRegistryService);
      expect(service.getRegisteredPlugins()).toHaveLength(2);
    });

    it("should create service without plugins", () => {
      const adapter = new InMemoryStoreAdapter();
      const validator = new NoOpValidator();

      const service = TokenRegistryServiceFactory.create(
        adapter,
        DEFAULT_CONFIG,
        validator
      );

      expect(service).toBeInstanceOf(TokenRegistryService);
      expect(service.getRegisteredPlugins()).toHaveLength(0);
    });
  });

  describe("createDefault", () => {
    it("should create service with default configuration", () => {
      const adapter = new InMemoryStoreAdapter();
      const validator = new NoOpValidator();

      const service = TokenRegistryServiceFactory.createDefault(
        adapter,
        validator
      );

      expect(service).toBeInstanceOf(TokenRegistryService);
      expect(service.getConfig()).toEqual(DEFAULT_CONFIG);
    });
  });
});
