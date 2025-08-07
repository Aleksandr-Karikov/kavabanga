import { Test, TestingModule } from "@nestjs/testing";
import { RedisTokenRepository } from "./redis-token-repository";
import { getRedisConnectionToken } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import {
  RefreshTokenStoreConfiguration,
  ExtendedRedis,
  TokenValidationError,
  TokenOperationFailedError,
  RefreshTokenData,
  InitializationError,
} from "../refresh-token.types";

// Unit tests with mocked Redis
describe("RedisTokenRepository (Unit)", () => {
  let repository: RedisTokenRepository;
  let mockRedis: jest.Mocked<ExtendedRedis>;

  const mockConfig: RefreshTokenStoreConfiguration = {
    ttl: 7 * 24 * 60 * 60,
    usedTokenTtl: 5 * 60,
    refreshTokenRedisPrefix: "refresh",
    userTokensSetRedisPrefix: "user_tokens",
    maxTokenLength: 255,
    maxDevicesPerUser: 10,
    maxBatchSize: 300,
    enableScheduledCleanup: true,
  };

  const TOKEN = "test-token";
  const USER_ID = "user-123";
  const DEVICE_ID = "device-456";

  const sampleTokenData: RefreshTokenData = {
    userId: USER_ID,
    deviceId: DEVICE_ID,
    issuedAt: Date.now(),
    used: false,
  };

  beforeEach(async () => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      sadd: jest.fn(),
      srem: jest.fn(),
      smembers: jest.fn(),
      scan: jest.fn(),
      ping: jest.fn(),
      pipeline: jest.fn(),
      defineCommand: jest.fn(),
      saveToken: jest.fn(),
      saveBatchTokens: jest.fn(),
      markTokenUsed: jest.fn(),
      deleteToken: jest.fn(),
      revokeAllTokens: jest.fn(),
      revokeDeviceTokens: jest.fn(),
      cleanupExpiredTokens: jest.fn(),
      getUserTokenStatsOptimized: jest.fn(),
    } as unknown as jest.Mocked<ExtendedRedis>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: RedisTokenRepository,
          useFactory: () => new RedisTokenRepository(mockRedis, mockConfig),
        },
        {
          provide: getRedisConnectionToken(),
          useValue: mockRedis,
        },
      ],
    }).compile();

    repository = module.get<RedisTokenRepository>(RedisTokenRepository);
  });

  describe("Key Generation", () => {
    it("should generate correct token key", () => {
      const key = repository.getTokenKey(TOKEN);
      expect(key).toBe(`refresh:${TOKEN}`);
    });

    it("should generate correct user tokens key", () => {
      const key = repository.getUserTokensKey(USER_ID);
      expect(key).toBe(`user_tokens:${USER_ID}`);
    });

    it("should generate correct user stats key", () => {
      const key = repository.getUserStatsKey(USER_ID);
      expect(key).toBe(`user_tokens:stats:${USER_ID}`);
    });
  });

  describe("getTokenData()", () => {
    it("should return null for empty token", async () => {
      const result = await repository.getTokenData("");
      expect(result).toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it("should return null for null token", async () => {
      const result = await repository.getTokenData(null);
      expect(result).toBeNull();
      expect(mockRedis.get).not.toHaveBeenCalled();
    });

    it("should return null for non-existent token", async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await repository.getTokenData("non-existent");
      expect(result).toBeNull();
      expect(mockRedis.get).toHaveBeenCalledWith("refresh:non-existent");
    });

    it("should return valid token data", async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(sampleTokenData));

      const result = await repository.getTokenData(TOKEN);
      expect(result).toEqual(sampleTokenData);
    });

    it("should throw TokenValidationError for invalid JSON", async () => {
      mockRedis.get.mockResolvedValue("invalid-json");

      await expect(repository.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should throw TokenValidationError for missing required fields", async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ userId: "test" }));

      await expect(repository.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should throw TokenValidationError for invalid field types", async () => {
      const invalidData = { ...sampleTokenData, issuedAt: "not-a-number" };
      mockRedis.get.mockResolvedValue(JSON.stringify(invalidData));

      await expect(repository.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should throw TokenOperationFailedError for Redis errors", async () => {
      mockRedis.get.mockRejectedValue(new Error("Redis connection failed"));

      await expect(repository.getTokenData(TOKEN)).rejects.toThrow(
        TokenOperationFailedError
      );
    });
  });

  describe("saveToken()", () => {
    it("should save token successfully", async () => {
      mockRedis.saveToken = jest.fn().mockResolvedValue(1);

      const result = await repository.saveToken(
        TOKEN,
        sampleTokenData,
        USER_ID
      );
      expect(result).toBe(1);
      expect(mockRedis.saveToken).toHaveBeenCalledWith(
        `refresh:${TOKEN}`,
        USER_ID,
        `user_tokens:${USER_ID}`,
        mockConfig.ttl,
        JSON.stringify(sampleTokenData)
      );
    });

    it("should throw TokenOperationFailedError for duplicate token", async () => {
      mockRedis.saveToken = jest.fn().mockResolvedValue(0);

      await expect(
        repository.saveToken(TOKEN, sampleTokenData, USER_ID)
      ).rejects.toThrow(TokenOperationFailedError);
    });

    it("should throw TokenOperationFailedError for Redis errors", async () => {
      mockRedis.saveToken = jest
        .fn()
        .mockRejectedValue(new Error("Redis error"));

      await expect(
        repository.saveToken(TOKEN, sampleTokenData, USER_ID)
      ).rejects.toThrow(TokenOperationFailedError);
    });
  });

  describe("saveBatchTokens()", () => {
    it("should return 0 for empty array", async () => {
      const result = await repository.saveBatchTokens([], USER_ID);
      expect(result).toBe(0);
      expect(mockRedis.saveBatchTokens).not.toHaveBeenCalled();
    });

    it("should save multiple tokens", async () => {
      const tokens = [
        { token: "token1", data: { ...sampleTokenData, deviceId: "device1" } },
        { token: "token2", data: { ...sampleTokenData, deviceId: "device2" } },
      ];
      mockRedis.saveBatchTokens = jest.fn().mockResolvedValue(2);

      const result = await repository.saveBatchTokens(tokens, USER_ID);
      expect(result).toBe(2);
    });

    it("should handle Redis errors", async () => {
      const tokens = [{ token: "token1", data: sampleTokenData }];
      mockRedis.saveBatchTokens = jest
        .fn()
        .mockRejectedValue(new Error("Redis error"));

      await expect(repository.saveBatchTokens(tokens, USER_ID)).rejects.toThrow(
        TokenOperationFailedError
      );
    });
  });

  describe("markTokenUsed()", () => {
    it("should mark token as used", async () => {
      mockRedis.markTokenUsed = jest.fn().mockResolvedValue(1);

      const result = await repository.markTokenUsed(TOKEN, USER_ID);
      expect(result).toBe(1);
    });

    it("should return 0 for non-existent token", async () => {
      mockRedis.markTokenUsed = jest.fn().mockResolvedValue(0);

      const result = await repository.markTokenUsed("non-existent", USER_ID);
      expect(result).toBe(0);
    });

    it("should handle Redis errors", async () => {
      mockRedis.markTokenUsed = jest
        .fn()
        .mockRejectedValue(new Error("Redis error"));

      await expect(repository.markTokenUsed(TOKEN, USER_ID)).rejects.toThrow(
        TokenOperationFailedError
      );
    });
  });

  describe("deleteToken()", () => {
    it("should delete token successfully", async () => {
      mockRedis.deleteToken = jest.fn().mockResolvedValue(1);

      const result = await repository.deleteToken(TOKEN, USER_ID);
      expect(result).toBe(1);
    });

    it("should handle Redis errors", async () => {
      mockRedis.deleteToken = jest
        .fn()
        .mockRejectedValue(new Error("Redis error"));

      await expect(repository.deleteToken(TOKEN, USER_ID)).rejects.toThrow(
        TokenOperationFailedError
      );
    });
  });

  describe("revokeAllTokens()", () => {
    it("should revoke all user tokens", async () => {
      mockRedis.revokeAllTokens = jest.fn().mockResolvedValue(5);

      const result = await repository.revokeAllTokens(USER_ID);
      expect(result).toBe(5);
    });

    it("should handle Redis errors", async () => {
      mockRedis.revokeAllTokens = jest
        .fn()
        .mockRejectedValue(new Error("Redis error"));

      await expect(repository.revokeAllTokens(USER_ID)).rejects.toThrow(
        TokenOperationFailedError
      );
    });
  });

  describe("revokeDeviceTokens()", () => {
    it("should revoke device tokens", async () => {
      mockRedis.revokeDeviceTokens = jest.fn().mockResolvedValue(3);

      const result = await repository.revokeDeviceTokens(USER_ID, DEVICE_ID);
      expect(result).toBe(3);
    });

    it("should handle Redis errors", async () => {
      mockRedis.revokeDeviceTokens = jest
        .fn()
        .mockRejectedValue(new Error("Redis error"));

      await expect(
        repository.revokeDeviceTokens(USER_ID, DEVICE_ID)
      ).rejects.toThrow(TokenOperationFailedError);
    });
  });

  describe("getUserTokenStatsOptimized()", () => {
    it("should return token stats", async () => {
      const expectedStats: [number, number, string[]] = [
        5,
        10,
        ["device1", "device2"],
      ];
      mockRedis.getUserTokenStatsOptimized = jest
        .fn()
        .mockResolvedValue(expectedStats);

      const result = await repository.getUserTokenStatsOptimized(
        USER_ID,
        100,
        300
      );
      expect(result).toEqual(expectedStats);
    });

    it("should handle Redis errors", async () => {
      mockRedis.getUserTokenStatsOptimized = jest
        .fn()
        .mockRejectedValue(new Error("Redis error"));

      await expect(
        repository.getUserTokenStatsOptimized(USER_ID, 100, 300)
      ).rejects.toThrow(TokenOperationFailedError);
    });
  });

  describe("cleanupUserExpiredTokens()", () => {
    it("should cleanup expired tokens", async () => {
      mockRedis.cleanupExpiredTokens = jest.fn().mockResolvedValue(3);

      const result = await repository.cleanupUserExpiredTokens(USER_ID);
      expect(result).toBe(3);
    });

    it("should handle Redis errors", async () => {
      mockRedis.cleanupExpiredTokens = jest
        .fn()
        .mockRejectedValue(new Error("Redis error"));

      await expect(
        repository.cleanupUserExpiredTokens(USER_ID)
      ).rejects.toThrow(TokenOperationFailedError);
    });
  });

  describe("scanUserTokenKeys()", () => {
    it("should scan user token keys", async () => {
      const expectedResult: [string, string[]] = [
        "0",
        ["user_tokens:1", "user_tokens:2"],
      ];
      mockRedis.scan.mockResolvedValue(expectedResult);

      const result = await repository.scanUserTokenKeys("0", 100);
      expect(result).toEqual(expectedResult);
      expect(mockRedis.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "user_tokens:*",
        "COUNT",
        100
      );
    });

    it("should handle Redis errors", async () => {
      mockRedis.scan.mockRejectedValue(new Error("Redis error"));

      await expect(repository.scanUserTokenKeys()).rejects.toThrow(
        TokenOperationFailedError
      );
    });
  });

  describe("deleteKey()", () => {
    it("should delete key successfully", async () => {
      mockRedis.del.mockResolvedValue(1);

      const result = await repository.deleteKey("test-key");
      expect(result).toBe(1);
      expect(mockRedis.del).toHaveBeenCalledWith("test-key");
    });

    it("should handle Redis errors", async () => {
      mockRedis.del.mockRejectedValue(new Error("Redis error"));

      await expect(repository.deleteKey("test-key")).rejects.toThrow(
        TokenOperationFailedError
      );
    });
  });

  describe("healthCheck()", () => {
    it("should return true for healthy connection", async () => {
      mockRedis.ping.mockResolvedValue("PONG");

      const result = await repository.healthCheck();
      expect(result).toBe(true);
    });

    it("should return false for unhealthy connection", async () => {
      mockRedis.ping.mockRejectedValue(new Error("Connection failed"));

      const result = await repository.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("createPipeline()", () => {
    it("should create pipeline", () => {
      const mockPipeline = { exec: jest.fn() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockRedis.pipeline.mockReturnValue(mockPipeline as any);

      const pipeline = repository.createPipeline();
      expect(pipeline).toBe(mockPipeline);
    });
  });
});

// Integration tests with real Redis
describe("RedisTokenRepository (Integration)", () => {
  let repository: RedisTokenRepository;
  let redis: Redis;
  let module: TestingModule;

  const mockConfig: RefreshTokenStoreConfiguration = {
    ttl: 7 * 24 * 60 * 60,
    usedTokenTtl: 5 * 60,
    refreshTokenRedisPrefix: "refresh",
    userTokensSetRedisPrefix: "user_tokens",
    maxTokenLength: 255,
    maxDevicesPerUser: 10,
    maxBatchSize: 300,
    enableScheduledCleanup: true,
  };

  const TOKEN = "test-token";
  const USER_ID = "user-123";
  const DEVICE_ID = "device-456";

  const sampleTokenData: RefreshTokenData = {
    userId: USER_ID,
    deviceId: DEVICE_ID,
    issuedAt: Date.now(),
    used: false,
  };

  beforeAll(async () => {
    const mockRedis = new Redis("redis://127.0.0.1:6379");

    module = await Test.createTestingModule({
      providers: [
        {
          provide: RedisTokenRepository,
          useFactory: () => new RedisTokenRepository(mockRedis, mockConfig),
        },
        {
          provide: getRedisConnectionToken(),
          useValue: mockRedis,
        },
      ],
    }).compile();

    repository = module.get<RedisTokenRepository>(RedisTokenRepository);
    redis = module.get<Redis>(getRedisConnectionToken());

    await repository.onModuleInit();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
    await module.close();
  });

  describe("Lua Scripts Integration", () => {
    it("should define all required Redis commands", () => {
      const extendedRedis = redis as ExtendedRedis;
      expect(typeof extendedRedis.saveToken).toBe("function");
      expect(typeof extendedRedis.saveBatchTokens).toBe("function");
      expect(typeof extendedRedis.markTokenUsed).toBe("function");
      expect(typeof extendedRedis.deleteToken).toBe("function");
      expect(typeof extendedRedis.revokeAllTokens).toBe("function");
      expect(typeof extendedRedis.revokeDeviceTokens).toBe("function");
      expect(typeof extendedRedis.cleanupExpiredTokens).toBe("function");
      expect(typeof extendedRedis.getUserTokenStatsOptimized).toBe("function");
    });
  });

  describe("Full Token Lifecycle", () => {
    it("should handle complete token operations", async () => {
      // Save token
      const saveResult = await repository.saveToken(
        TOKEN,
        sampleTokenData,
        USER_ID
      );
      expect(saveResult).toBe(1);

      // Get token data
      const tokenData = await repository.getTokenData(TOKEN);
      expect(tokenData).toEqual(sampleTokenData);

      // Mark as used
      const markResult = await repository.markTokenUsed(TOKEN, USER_ID);
      expect(markResult).toBe(1);

      // Verify token is marked as used
      const usedTokenData = await repository.getTokenData(TOKEN);
      expect(usedTokenData?.used).toBe(true);

      // Delete token
      const deleteResult = await repository.deleteToken(TOKEN, USER_ID);
      expect(deleteResult).toBe(1);

      // Verify token is deleted
      const finalCheck = await repository.getTokenData(TOKEN);
      expect(finalCheck).toBeNull();
    });

    it("should prevent duplicate token creation", async () => {
      await repository.saveToken(TOKEN, sampleTokenData, USER_ID);

      await expect(
        repository.saveToken(TOKEN, sampleTokenData, USER_ID)
      ).rejects.toThrow(TokenOperationFailedError);
    });

    it("should validate user ownership in operations", async () => {
      await repository.saveToken(TOKEN, sampleTokenData, USER_ID);

      const wrongUserResult = await repository.markTokenUsed(
        TOKEN,
        "wrong-user"
      );
      expect(wrongUserResult).toBe(0);

      const deleteWrongUserResult = await repository.deleteToken(
        TOKEN,
        "wrong-user"
      );
      expect(deleteWrongUserResult).toBe(0);
    });
  });

  describe("Batch Operations", () => {
    it("should save multiple tokens in batch", async () => {
      const tokens = [
        { token: "batch1", data: { ...sampleTokenData, deviceId: "device1" } },
        { token: "batch2", data: { ...sampleTokenData, deviceId: "device2" } },
        { token: "batch3", data: { ...sampleTokenData, deviceId: "device3" } },
      ];

      const result = await repository.saveBatchTokens(tokens, USER_ID);
      expect(result).toBe(3);

      // Verify all tokens were saved
      for (const { token } of tokens) {
        const stored = await repository.getTokenData(token);
        expect(stored).toBeDefined();
      }
    });

    it("should handle partial batch failures gracefully", async () => {
      const tokens = [
        { token: "valid1", data: sampleTokenData },
        { token: "duplicate", data: sampleTokenData },
        { token: "duplicate", data: sampleTokenData }, // This will fail
        { token: "valid2", data: sampleTokenData },
      ];

      // First save one token to create a duplicate scenario
      await repository.saveToken("duplicate", sampleTokenData, USER_ID);

      const result = await repository.saveBatchTokens(tokens, USER_ID);
      expect(result).toBe(2); // Should save valid1 and valid2, skip duplicates
    });
  });

  describe("Device Token Management", () => {
    beforeEach(async () => {
      const tokens = [
        { token: "mobile1", data: { ...sampleTokenData, deviceId: "mobile" } },
        { token: "mobile2", data: { ...sampleTokenData, deviceId: "mobile" } },
        {
          token: "desktop1",
          data: { ...sampleTokenData, deviceId: "desktop" },
        },
      ];

      for (const { token, data } of tokens) {
        await repository.saveToken(token, data, USER_ID);
      }
    });

    it("should revoke tokens for specific device", async () => {
      const result = await repository.revokeDeviceTokens(USER_ID, "mobile");
      expect(result).toBe(2);

      // Verify mobile tokens are deleted
      expect(await repository.getTokenData("mobile1")).toBeNull();
      expect(await repository.getTokenData("mobile2")).toBeNull();

      // Verify desktop token remains
      expect(await repository.getTokenData("desktop1")).toBeDefined();
    });

    it("should revoke all user tokens", async () => {
      const result = await repository.revokeAllTokens(USER_ID);
      expect(result).toBe(3);

      // Verify all tokens are deleted
      expect(await repository.getTokenData("mobile1")).toBeNull();
      expect(await repository.getTokenData("mobile2")).toBeNull();
      expect(await repository.getTokenData("desktop1")).toBeNull();
    });
  });

  describe("Statistics and Cleanup", () => {
    beforeEach(async () => {
      const tokens = [
        { token: "active1", data: { ...sampleTokenData, deviceId: "mobile" } },
        { token: "active2", data: { ...sampleTokenData, deviceId: "desktop" } },
        { token: "used1", data: { ...sampleTokenData, deviceId: "tablet" } },
      ];

      for (const { token, data } of tokens) {
        await repository.saveToken(token, data, USER_ID);
      }

      // Mark one token as used
      await repository.markTokenUsed("used1", USER_ID);
    });

    it("should return correct token statistics", async () => {
      const [activeTokens, totalTokens, devices] =
        await repository.getUserTokenStatsOptimized(USER_ID, 100, 300);

      expect(activeTokens).toBe(2);
      expect(totalTokens).toBe(2);
      expect(devices).toHaveLength(2);
      expect(devices).toContain("mobile");
      expect(devices).toContain("desktop");
      expect(devices).not.toContain("tablet");
    });

    it("should cleanup expired tokens", async () => {
      // Create orphaned reference
      const userTokensKey = repository.getUserTokensKey(USER_ID);
      await redis.sadd(userTokensKey, "refresh:orphaned-token");

      const result = await repository.cleanupUserExpiredTokens(USER_ID);
      expect(result).toBe(1);

      // Verify orphaned reference was removed
      const userTokens = await redis.smembers(userTokensKey);
      expect(userTokens).not.toContain("refresh:orphaned-token");
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle malformed token data", async () => {
      // Manually insert malformed data
      const key = repository.getTokenKey("malformed");
      await redis.set(key, "invalid-json");

      await expect(repository.getTokenData("malformed")).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should handle missing required fields in token data", async () => {
      const key = repository.getTokenKey("incomplete");
      await redis.set(key, JSON.stringify({ userId: "test" }));

      await expect(repository.getTokenData("incomplete")).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should handle concurrent access correctly", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        repository.saveToken(
          `concurrent-${i}`,
          {
            ...sampleTokenData,
            deviceId: `device-${i}`,
          },
          USER_ID
        )
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter((r) => r.status === "fulfilled");

      expect(successful).toHaveLength(10);
    });

    it("should scan user token keys correctly", async () => {
      // Create tokens for multiple users
      const users = ["user1", "user2", "user3"];
      for (const userId of users) {
        await repository.saveToken(
          `token-${userId}`,
          {
            ...sampleTokenData,
            userId,
          },
          userId
        );
      }

      const [cursor, keys] = await repository.scanUserTokenKeys("0", 10);
      expect(cursor).toBe("0");
      expect(keys.length).toBe(3);
      expect(keys.every((key) => key.startsWith("user_tokens:"))).toBe(true);
    });
  });

  describe("Performance Tests", () => {
    it("should handle large batch operations efficiently", async () => {
      const tokens = Array.from({ length: 100 }, (_, i) => ({
        token: `perf-${i}`,
        data: { ...sampleTokenData, deviceId: `device-${i}` },
      }));

      const start = Date.now();
      const result = await repository.saveBatchTokens(tokens, USER_ID);
      const duration = Date.now() - start;

      expect(result).toBe(100);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it("should handle stats calculation for many tokens efficiently", async () => {
      // Create many tokens
      const tokens = Array.from({ length: 50 }, (_, i) => ({
        token: `stats-${i}`,
        data: { ...sampleTokenData, deviceId: `device-${i % 10}` },
      }));

      await repository.saveBatchTokens(tokens, USER_ID);

      const start = Date.now();
      const [activeTokens, totalTokens, devices] =
        await repository.getUserTokenStatsOptimized(USER_ID, 100, 300);
      const duration = Date.now() - start;

      expect(activeTokens).toBe(50);
      expect(totalTokens).toBe(50);
      expect(devices).toHaveLength(10);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });
});

// Error injection tests
describe("RedisTokenRepository (Error Scenarios)", () => {
  let repository: RedisTokenRepository;
  let mockRedis: jest.Mocked<Redis>;

  const mockConfig: RefreshTokenStoreConfiguration = {
    ttl: 7 * 24 * 60 * 60,
    usedTokenTtl: 5 * 60,
    refreshTokenRedisPrefix: "refresh",
    userTokensSetRedisPrefix: "user_tokens",
    maxTokenLength: 255,
    maxDevicesPerUser: 10,
    maxBatchSize: 300,
    enableScheduledCleanup: true,
  };

  beforeEach(() => {
    mockRedis = {
      defineCommand: jest.fn(),
      ping: jest.fn(),
      get: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    repository = new RedisTokenRepository(mockRedis, mockConfig);
  });

  describe("Initialization Errors", () => {
    it("should handle script initialization failure", async () => {
      mockRedis.defineCommand.mockImplementation(() => {
        throw new Error("Failed to define command");
      });
      const repo = new RedisTokenRepository(mockRedis, mockConfig);
      await expect(repo.onModuleInit()).rejects.toThrow(InitializationError);
    });

    it("should wait for initialization before operations", async () => {
      let resolveInit: () => void;
      const initPromise = new Promise<void>((resolve) => {
        resolveInit = resolve;
      });

      mockRedis.defineCommand.mockImplementation(() => {
        return initPromise;
      });

      mockRedis.get.mockResolvedValue(null);

      const repo = new RedisTokenRepository(mockRedis, mockConfig);
      const getDataPromise = repo.getTokenData("test");

      // Resolve initialization after a delay
      setTimeout(() => resolveInit(), 50);

      // Should wait for initialization and then return null
      await expect(getDataPromise).resolves.toBeNull();
      expect(mockRedis.defineCommand).toHaveBeenCalled();
    });
  });

  describe("Network Error Scenarios", () => {
    beforeEach(async () => {
      // Mock successful initialization
      mockRedis.defineCommand.mockReturnValue(undefined);
      await repository.onModuleInit();
    });

    it("should handle network timeouts", async () => {
      mockRedis.get.mockRejectedValue(new Error("ETIMEDOUT"));

      await expect(repository.getTokenData("test")).rejects.toThrow(
        TokenOperationFailedError
      );
    });

    it("should handle connection refused errors", async () => {
      mockRedis.get.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(repository.getTokenData("test")).rejects.toThrow(
        TokenOperationFailedError
      );
    });

    it("should handle Redis server errors", async () => {
      mockRedis.get.mockRejectedValue(
        new Error("READONLY You can't write against a read only replica")
      );

      await expect(repository.getTokenData("test")).rejects.toThrow(
        TokenOperationFailedError
      );
    });
  });
});
