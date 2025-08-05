import { Test, TestingModule } from "@nestjs/testing";
import { RedisTokenRepository } from "./redis-token-repository";
import { getRedisConnectionToken } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import {
  RefreshTokenStoreConfiguration,
  ExtendedRedis,
  TokenValidationError,
  RefreshTokenData,
} from "../refresh-token.types";

describe("RedisTokenRepository", () => {
  let repository: RedisTokenRepository;
  let redis: Redis;
  let module: TestingModule;

  const mockConfig: RefreshTokenStoreConfiguration = {
    ttl: 7 * 24 * 60 * 60, // 7 days
    usedTokenTtl: 5 * 60, // 5 minutes
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

  describe("Lua Scripts Initialization", () => {
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

  describe("getTokenData()", () => {
    it("should return null for empty token", async () => {
      const result = await repository.getTokenData("");
      expect(result).toBeNull();
    });

    it("should return null for non-existent token", async () => {
      const result = await repository.getTokenData("non-existent");
      expect(result).toBeNull();
    });

    it("should return valid token data", async () => {
      const key = repository.getTokenKey(TOKEN);
      await redis.set(key, JSON.stringify(sampleTokenData));

      const result = await repository.getTokenData(TOKEN);
      expect(result).toEqual(sampleTokenData);
    });

    it("should throw error for invalid JSON", async () => {
      const key = repository.getTokenKey(TOKEN);
      await redis.set(key, "invalid-json");

      await expect(repository.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should handle null/undefined token gracefully", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result1 = await repository.getTokenData(null as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result2 = await repository.getTokenData(undefined as any);

      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });

  describe("saveToken()", () => {
    it("should save token successfully", async () => {
      const result = await repository.saveToken(
        TOKEN,
        sampleTokenData,
        USER_ID
      );
      expect(result).toBe(1);

      const stored = await redis.get(repository.getTokenKey(TOKEN));
      expect(JSON.parse(stored)).toEqual(sampleTokenData);

      const userTokens = await redis.smembers(
        repository.getUserTokensKey(USER_ID)
      );
      expect(userTokens).toContain(repository.getTokenKey(TOKEN));
    });

    it("should fail for duplicate token", async () => {
      await repository.saveToken(TOKEN, sampleTokenData, USER_ID);

      await expect(
        repository.saveToken(TOKEN, sampleTokenData, USER_ID)
      ).rejects.toThrow();
    });

    it("should validate user ID mismatch", async () => {
      const mismatchedData = { ...sampleTokenData, userId: "different-user" };

      await expect(
        repository.saveToken(TOKEN, mismatchedData, USER_ID)
      ).rejects.toThrow();
    });
  });

  describe("saveBatchTokens()", () => {
    it("should save multiple tokens", async () => {
      const tokens = [
        { token: "token1", data: { ...sampleTokenData, deviceId: "device1" } },
        { token: "token2", data: { ...sampleTokenData, deviceId: "device2" } },
      ];

      const result = await repository.saveBatchTokens(tokens, USER_ID);
      expect(result).toBe(2);

      for (const { token } of tokens) {
        const stored = await redis.get(repository.getTokenKey(token));
        expect(stored).toBeDefined();
      }
    });

    it("should return 0 for empty array", async () => {
      const result = await repository.saveBatchTokens([], USER_ID);
      expect(result).toBe(0);
    });

    it("should handle duplicate tokens gracefully", async () => {
      const tokens = [
        { token: "duplicate", data: sampleTokenData },
        { token: "duplicate", data: sampleTokenData },
        { token: "unique", data: sampleTokenData },
      ];

      const result = await repository.saveBatchTokens(tokens, USER_ID);
      expect(result).toBe(2); // Only first duplicate and unique should succeed
    });
  });

  describe("markTokenUsed()", () => {
    beforeEach(async () => {
      await repository.saveToken(TOKEN, sampleTokenData, USER_ID);
    });

    it("should mark token as used", async () => {
      const result = await repository.markTokenUsed(TOKEN, USER_ID);
      expect(result).toBe(1);

      const data = await repository.getTokenData(TOKEN);
      expect(data?.used).toBe(true);

      // Should be removed from user tokens set
      const userTokens = await redis.smembers(
        repository.getUserTokensKey(USER_ID)
      );
      expect(userTokens).not.toContain(repository.getTokenKey(TOKEN));
    });

    it("should return 0 for non-existent token", async () => {
      const result = await repository.markTokenUsed("non-existent", USER_ID);
      expect(result).toBe(0);
    });

    it("should return 0 for wrong user", async () => {
      const result = await repository.markTokenUsed(TOKEN, "wrong-user");
      expect(result).toBe(0);
    });

    it("should return 0 for already used token", async () => {
      await repository.markTokenUsed(TOKEN, USER_ID);
      const result = await repository.markTokenUsed(TOKEN, USER_ID);
      expect(result).toBe(0);
    });
  });

  describe("deleteToken()", () => {
    beforeEach(async () => {
      await repository.saveToken(TOKEN, sampleTokenData, USER_ID);
    });

    it("should delete token successfully", async () => {
      const result = await repository.deleteToken(TOKEN, USER_ID);
      expect(result).toBe(1);

      const exists = await redis.get(repository.getTokenKey(TOKEN));
      expect(exists).toBeNull();

      const userTokens = await redis.smembers(
        repository.getUserTokensKey(USER_ID)
      );
      expect(userTokens).not.toContain(repository.getTokenKey(TOKEN));
    });

    it("should return 0 for non-existent token", async () => {
      const result = await repository.deleteToken("non-existent", USER_ID);
      expect(result).toBe(0);
    });

    it("should return 0 for wrong user", async () => {
      const result = await repository.deleteToken(TOKEN, "wrong-user");
      expect(result).toBe(0);
    });
  });

  describe("revokeAllTokens()", () => {
    it("should revoke all user tokens", async () => {
      await repository.saveToken("token1", sampleTokenData, USER_ID);
      await repository.saveToken(
        "token2",
        { ...sampleTokenData, deviceId: "device2" },
        USER_ID
      );

      const result = await repository.revokeAllTokens(USER_ID);
      expect(result).toBe(2);

      const token1Exists = await redis.get(repository.getTokenKey("token1"));
      const token2Exists = await redis.get(repository.getTokenKey("token2"));
      expect(token1Exists).toBeNull();
      expect(token2Exists).toBeNull();

      const userTokensExists = await redis.exists(
        repository.getUserTokensKey(USER_ID)
      );
      expect(userTokensExists).toBe(0);
    });

    it("should return 0 for user with no tokens", async () => {
      const result = await repository.revokeAllTokens("no-tokens-user");
      expect(result).toBe(0);
    });
  });

  describe("revokeDeviceTokens()", () => {
    beforeEach(async () => {
      await repository.saveToken(
        "mobile-token",
        { ...sampleTokenData, deviceId: "mobile" },
        USER_ID
      );
      await repository.saveToken(
        "desktop-token",
        { ...sampleTokenData, deviceId: "desktop" },
        USER_ID
      );
      await repository.saveToken(
        "mobile-token2",
        { ...sampleTokenData, deviceId: "mobile" },
        USER_ID
      );
    });

    it("should revoke tokens for specific device", async () => {
      const result = await repository.revokeDeviceTokens(USER_ID, "mobile");
      expect(result).toBe(2);

      const mobileExists = await redis.get(
        repository.getTokenKey("mobile-token")
      );
      const mobile2Exists = await redis.get(
        repository.getTokenKey("mobile-token2")
      );
      const desktopExists = await redis.get(
        repository.getTokenKey("desktop-token")
      );

      expect(mobileExists).toBeNull();
      expect(mobile2Exists).toBeNull();
      expect(desktopExists).not.toBeNull();
    });

    it("should clean up orphaned keys", async () => {
      // Add orphaned key to user tokens set
      const userTokensKey = repository.getUserTokensKey(USER_ID);
      await redis.sadd(userTokensKey, "refresh:orphaned-token");

      const result = await repository.revokeDeviceTokens(USER_ID, "mobile");
      expect(result).toBe(2);

      // Orphaned key should be removed from set
      const userTokens = await redis.smembers(userTokensKey);
      expect(userTokens).not.toContain("refresh:orphaned-token");
    });
  });

  describe("getUserTokenStatsOptimized()", () => {
    beforeEach(async () => {
      const tokens = [
        { token: "active1", data: { ...sampleTokenData, deviceId: "mobile" } },
        { token: "active2", data: { ...sampleTokenData, deviceId: "desktop" } },
        {
          token: "used1",
          data: { ...sampleTokenData, deviceId: "tablet", used: true },
        },
      ];

      for (const { token, data } of tokens) {
        await repository.saveToken(token, data, USER_ID);
      }

      await repository.markTokenUsed("used1", USER_ID);
    });

    it("should return correct stats", async () => {
      const [activeTokens, totalTokens, devices] =
        await repository.getUserTokenStatsOptimized(USER_ID, 100, "", 300);

      expect(activeTokens).toBe(2);
      expect(totalTokens).toBe(3);
      expect(devices).toHaveLength(3);
      expect(devices).toContain("mobile");
      expect(devices).toContain("desktop");
    });
  });

  describe("cleanupUserExpiredTokens()", () => {
    it("should clean up expired tokens", async () => {
      await repository.saveToken("valid-token", sampleTokenData, USER_ID);

      // Manually expire a token and add orphaned reference
      await redis.del(repository.getTokenKey("expired-token"));
      await redis.sadd(
        repository.getUserTokensKey(USER_ID),
        repository.getTokenKey("expired-token")
      );

      const result = await repository.cleanupUserExpiredTokens(USER_ID);
      expect(result).toBe(1);

      const userTokens = await redis.smembers(
        repository.getUserTokensKey(USER_ID)
      );
      expect(userTokens).not.toContain(repository.getTokenKey("expired-token"));
      expect(userTokens).toContain(repository.getTokenKey("valid-token"));
    });
  });

  describe("scanUserTokenKeys()", () => {
    beforeEach(async () => {
      await repository.saveToken(
        "token1",
        { ...sampleTokenData, userId: "user1" },
        "user1"
      );
      await repository.saveToken(
        "token2",
        { ...sampleTokenData, userId: "user2" },
        "user2"
      );
      await repository.saveToken(
        "token3",
        { ...sampleTokenData, userId: "user3" },
        "user3"
      );
    });

    it("should scan user token keys", async () => {
      const [cursor, keys] = await repository.scanUserTokenKeys("0", 10);

      expect(cursor).toBe("0"); // Should complete in one scan for small dataset
      expect(keys.length).toBe(3);
      expect(keys.every((key) => key.startsWith("user_tokens:"))).toBe(true);
    });
  });

  describe("Utility Methods", () => {
    it("should delete key", async () => {
      await redis.set("test-key", "test-value");

      const result = await repository.deleteKey("test-key");
      expect(result).toBe(1);

      const exists = await redis.exists("test-key");
      expect(exists).toBe(0);
    });

    it("should create pipeline", () => {
      const pipeline = repository.createPipeline();
      expect(pipeline).toBeDefined();
      expect(typeof pipeline.exec).toBe("function");
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed JSON gracefully in getTokenData", async () => {
      const key = repository.getTokenKey(TOKEN);
      await redis.set(key, '{"invalid": json}');

      await expect(repository.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("should handle empty token data gracefully", async () => {
      const key = repository.getTokenKey(TOKEN);
      await redis.set(key, "");

      await expect(repository.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });
  });

  describe("Performance and Concurrency", () => {
    it("should handle concurrent save operations", async () => {
      const promises = [
        repository.saveToken("concurrent1", sampleTokenData, USER_ID),
        repository.saveToken(
          "concurrent2",
          { ...sampleTokenData, deviceId: "device2" },
          USER_ID
        ),
        repository.saveToken(
          "concurrent3",
          { ...sampleTokenData, deviceId: "device3" },
          USER_ID
        ),
      ];

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter((r) => r.status === "fulfilled");

      expect(fulfilled).toHaveLength(3);
    });

    it("should handle large batch operations efficiently", async () => {
      const tokens = Array.from({ length: 50 }, (_, i) => ({
        token: `batch-${i}`,
        data: { ...sampleTokenData, deviceId: `device-${i}` },
      }));

      const start = Date.now();
      const result = await repository.saveBatchTokens(tokens, USER_ID);
      const duration = Date.now() - start;

      expect(result).toBe(50);
      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });
});
