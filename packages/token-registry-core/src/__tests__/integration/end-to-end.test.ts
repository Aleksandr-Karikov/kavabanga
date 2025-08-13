// Mock @nestjs/testing if not available
let Test: any;

try {
  const testing = require("@nestjs/testing");
  Test = testing.Test;
} catch {
  // Mock implementation for when @nestjs packages are not available
  Test = {
    createTestingModule: jest.fn(() => ({
      compile: jest.fn(() => ({
        get: jest.fn((token: any) => {
          if (token === "TokenRegistryService") return {};
          return {};
        }),
      })),
    })),
  };
}
import {
  TokenRegistryModule,
  TokenRegistryService,
  InMemoryStoreAdapter,
  DefaultTokenValidator,
  StrictTokenValidator,
  createTestTokenRegistryModule,
  TokenValidationError,
  TokenNotFoundError,
  DEFAULT_CONFIG,
} from "../../index";
import {
  createTestSaveRequest,
  createMockPlugin,
  expectTokenData,
  waitFor,
} from "../utils/test-helpers";

describe("End-to-End Integration Tests", () => {
  describe("Complete Workflow", () => {
    let service: TokenRegistryService;
    let adapter: InMemoryStoreAdapter;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            config: {
              enableValidation: true,
              operationTimeout: 1000,
            },
          }),
        ],
      }).compile();

      service = module.get(TokenRegistryService) as TokenRegistryService;
      adapter = service.getStoreAdapter() as InMemoryStoreAdapter;
    });

    afterEach(() => {
      adapter.clear();
    });

    it("should complete full token lifecycle", async () => {
      const tokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000, // 1 hour
        meta: {
          deviceId: "device123",
          ipAddress: "192.168.1.1",
          userAgent: "Test-Agent/1.0",
        },
      };

      // 1. Save token
      await service.saveToken("token123", tokenData, 3600);

      // 2. Verify token was saved
      expect(adapter.getActiveTokenCount()).toBe(1);
      expect(adapter.getActiveTokens()).toContain("token123");

      // 3. Retrieve token
      const retrievedData = await service.getTokenData("token123");
      expectTokenData(retrievedData, tokenData);

      // 4. Verify token is healthy
      const isHealthy = await service.getHealthStatus();
      expect(isHealthy).toBe(true);

      // 5. Revoke token
      await service.revokeToken("token123");

      // 6. Verify token was removed
      expect(adapter.getActiveTokenCount()).toBe(0);
      const afterRevoke = await service.getTokenData("token123");
      expect(afterRevoke).toBeNull();
    });

    it("should work with plugins throughout lifecycle", async () => {
      const auditPlugin = createMockPlugin("AuditPlugin", 50);
      const metricsPlugin = createMockPlugin("MetricsPlugin", 100);

      service.registerPlugin(auditPlugin);
      service.registerPlugin(metricsPlugin);

      const request = createTestSaveRequest();

      // Save token (should trigger preSave and postSave)
      await service.saveToken(request.token, request.data, request.ttl);

      expect(auditPlugin.preSave).toHaveBeenCalledWith(request);
      expect(auditPlugin.postSave).toHaveBeenCalledWith(request);
      expect(metricsPlugin.preSave).toHaveBeenCalledWith(request);
      expect(metricsPlugin.postSave).toHaveBeenCalledWith(request);

      // Get token (should trigger preGet and postGet)
      await service.getTokenData(request.token);

      expect(auditPlugin.preGet).toHaveBeenCalledWith(request.token);
      expect(auditPlugin.postGet).toHaveBeenCalledWith(
        request.token,
        request.data
      );
      expect(metricsPlugin.preGet).toHaveBeenCalledWith(request.token);
      expect(metricsPlugin.postGet).toHaveBeenCalledWith(
        request.token,
        request.data
      );

      // Revoke token (should trigger preRevoke and postRevoke)
      await service.revokeToken(request.token);

      expect(auditPlugin.preRevoke).toHaveBeenCalledWith(
        request.token,
        request.data
      );
      expect(auditPlugin.postRevoke).toHaveBeenCalledWith(
        request.token,
        request.data
      );
      expect(metricsPlugin.preRevoke).toHaveBeenCalledWith(
        request.token,
        request.data
      );
      expect(metricsPlugin.postRevoke).toHaveBeenCalledWith(
        request.token,
        request.data
      );
    });
  });

  describe("Different Validators", () => {
    it("should work with DefaultTokenValidator", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            validator: new DefaultTokenValidator(DEFAULT_CONFIG),
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;
      const request = createTestSaveRequest();

      await service.saveToken(request.token, request.data, request.ttl);
      const data = await service.getTokenData(request.token);

      expectTokenData(data, request.data);
    });

    it("should work with StrictTokenValidator", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            validator: new StrictTokenValidator(DEFAULT_CONFIG),
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      // Valid request for strict validator
      const validRequest = createTestSaveRequest({
        token:
          "a-very-long-and-secure-token-for-strict-validation-with-good-entropy-123456789",
        data: {
          sub: "user123",
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60000,
          meta: {
            deviceId: "device123",
            ipAddress: "203.0.113.1", // Example IP (not suspicious)
            userAgent: "Test-Agent/1.0",
          },
        },
      });

      await service.saveToken(
        validRequest.token,
        validRequest.data,
        validRequest.ttl
      );
      const data = await service.getTokenData(validRequest.token);

      expectTokenData(data, validRequest.data);
    });

    it("should reject invalid tokens with validators", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            validator: new DefaultTokenValidator(DEFAULT_CONFIG),
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      // Invalid token (too short)
      await expect(
        service.saveToken("short", createTestSaveRequest().data, 60)
      ).rejects.toThrow("Validation failed");

      // Invalid token data (missing sub)
      const invalidData = { ...createTestSaveRequest().data };
      delete (invalidData as any).sub;

      await expect(
        service.saveToken("valid-token-123", invalidData as any, 60)
      ).rejects.toThrow("Validation failed");
    });
  });

  describe("Automatic Token Expiration", () => {
    it("should automatically expire tokens", async () => {
      jest.useFakeTimers();

      const module = await Test.createTestingModule({
        imports: [createTestTokenRegistryModule(new InMemoryStoreAdapter())],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;
      const adapter = service.getStoreAdapter() as InMemoryStoreAdapter;

      const request = createTestSaveRequest();

      // Save token with 1 second TTL
      await service.saveToken(request.token, request.data, 1);

      // Token should exist immediately
      let data = await service.getTokenData(request.token);
      expect(data).not.toBeNull();

      // Fast-forward time
      jest.advanceTimersByTime(1100);

      // Token should be expired
      data = await service.getTokenData(request.token);
      expect(data).toBeNull();

      jest.useRealTimers();
    });
  });

  describe("Error Handling", () => {
    let service: TokenRegistryService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
          }),
        ],
      }).compile();

      service = module.get(TokenRegistryService) as TokenRegistryService;
    });

    it("should handle token not found errors", async () => {
      await expect(service.revokeToken("non-existent")).rejects.toThrow(
        TokenNotFoundError
      );

      const data = await service.getTokenData("non-existent");
      expect(data).toBeNull();
    });

    it("should handle plugin errors gracefully", async () => {
      const errorPlugin = {
        name: "ErrorPlugin",
        priority: 100,
        preSave: jest.fn().mockRejectedValue(new Error("Plugin error")),
        onError: jest.fn(),
      };

      service.registerPlugin(errorPlugin);

      // Mock console.error to avoid noise
      const originalError = console.error;
      console.error = jest.fn();

      try {
        const request = createTestSaveRequest();

        // Should still save despite plugin error
        await service.saveToken(request.token, request.data, request.ttl);

        const data = await service.getTokenData(request.token);
        expect(data).not.toBeNull();

        // Plugin should be notified of error
        expect(errorPlugin.onError).toHaveBeenCalled();
      } finally {
        console.error = originalError;
      }
    });

    it("should handle service shutdown gracefully", async () => {
      const request = createTestSaveRequest();

      // Save a token first
      await service.saveToken(request.token, request.data, request.ttl);

      // Shutdown service
      await service.shutdown();

      // Operations should fail after shutdown
      await expect(
        service.saveToken("new-token", request.data, 60)
      ).rejects.toThrow("Service is shutting down");

      // Existing tokens should also fail to be read after shutdown
      await expect(service.getTokenData(request.token)).rejects.toThrow(
        "Service is shutting down"
      );
    });
  });

  describe("Configuration Scenarios", () => {
    it("should work with disabled validation", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            config: {
              enableValidation: false,
            },
            validator: "none",
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      // Should work even with invalid data
      await service.saveToken("invalid-token", {} as any, -1);

      const data = await service.getTokenData("invalid-token");
      expect(data).toEqual({});
    });

    it("should work with disabled plugins", async () => {
      const plugin = createMockPlugin("TestPlugin");

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            config: {
              enablePlugins: false,
            },
            plugins: [plugin],
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;
      const request = createTestSaveRequest();

      await service.saveToken(request.token, request.data, request.ttl);

      // Plugin should not be called when disabled
      expect(plugin.preSave).not.toHaveBeenCalled();
      expect(plugin.postSave).not.toHaveBeenCalled();
    });

    it("should respect operation timeout", async () => {
      // Create a slow adapter
      class SlowAdapter extends InMemoryStoreAdapter {
        async saveToken(request: any): Promise<void> {
          await waitFor(200); // 200ms delay
          return super.saveToken(request);
        }
      }

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new SlowAdapter(),
            config: {
              operationTimeout: 100, // 100ms timeout
            },
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;
      const request = createTestSaveRequest();

      await expect(
        service.saveToken(request.token, request.data, request.ttl)
      ).rejects.toThrow("timed out");
    });
  });

  describe("Real-world Scenarios", () => {
    it("should handle user session management", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            config: {
              defaultTtl: 7200, // 2 hours
              enableValidation: true,
            },
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      // User logs in - create refresh token
      const sessionData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 7200000, // 2 hours
        meta: {
          deviceId: "mobile-device-456",
          ipAddress: "192.168.1.1",
          userAgent: "MyApp/1.0 (iOS)",
          sessionType: "refresh_token",
        },
      };

      const refreshToken = "refresh_token_" + Math.random().toString(36);
      await service.saveToken(refreshToken, sessionData);

      // Verify user can use refresh token
      const retrievedSession = await service.getTokenData(refreshToken);
      expect(retrievedSession).not.toBeNull();
      expect(retrievedSession!.sub).toBe("user123");

      // User logs out - revoke refresh token
      await service.revokeToken(refreshToken);

      // Verify token is no longer valid
      const afterLogout = await service.getTokenData(refreshToken);
      expect(afterLogout).toBeNull();
    });

    it("should handle multi-device management", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;
      const userId = "user123";

      // User logs in from multiple devices
      const devices = [
        { id: "device1", type: "mobile", ip: "192.168.1.10" },
        { id: "device2", type: "desktop", ip: "192.168.1.11" },
        { id: "device3", type: "tablet", ip: "192.168.1.12" },
      ];

      const tokens: string[] = [];

      for (const device of devices) {
        const sessionData = {
          sub: userId,
          issuedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
          meta: {
            deviceId: device.id,
            deviceType: device.type,
            ipAddress: device.ip,
          },
        };

        const token = `${userId}_${device.id}_${Date.now()}`;
        await service.saveToken(token, sessionData);
        tokens.push(token);
      }

      // Verify all devices have active sessions
      for (const token of tokens) {
        const session = await service.getTokenData(token);
        expect(session).not.toBeNull();
        expect(session!.sub).toBe(userId);
      }

      // Revoke session from one device
      await service.revokeToken(tokens[0]!);

      // Verify only that device's session was revoked
      expect(await service.getTokenData(tokens[0]!)).toBeNull();
      expect(await service.getTokenData(tokens[1]!)).not.toBeNull();
      expect(await service.getTokenData(tokens[2]!)).not.toBeNull();
    });
  });
});
