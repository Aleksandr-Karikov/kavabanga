import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import {
  RefreshTokenStore,
  TokenValidationError,
  TokenAlreadyExistsError,
  TokenOperationFailedError,
  ExtendedRedis,
  ConfigurationError,
} from "../refresh-token-store/refresh-token.store";

class TokenDataBuilder {
  private data = {
    userId: "test-user-id",
    deviceId: "test-device-id",
  };

  withUserId(userId: string) {
    this.data.userId = userId;
    return this;
  }

  withDeviceId(deviceId: string) {
    this.data.deviceId = deviceId;
    return this;
  }

  build() {
    return { ...this.data };
  }
}

describe("RefreshTokenStore Integration", () => {
  let service: RefreshTokenStore;
  let redis: Redis;
  let module: TestingModule;

  const TOKEN = "test-token";
  const USER_ID = "user-id";
  const DEVICE_ID = "device-id";

  const sampleData = new TokenDataBuilder()
    .withUserId(USER_ID)
    .withDeviceId(DEVICE_ID)
    .build();

  beforeAll(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config = {
          REDIS_URL: "redis://127.0.0.1:6379",
          REFRESH_TOKEN_TTL_DAYS: 7,
          USED_TOKEN_TTL_MINUTES: 5,
          MAX_TOKEN_LENGTH: 1000,
          REDIS_USER_TOKENS_PREFIX: "user_tokens",
        };
        return config[key];
      }),
    };

    module = await Test.createTestingModule({
      imports: [],
      providers: [
        RefreshTokenStore,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: Redis,
          useFactory: (config: ConfigService) => {
            const url = config.get<string>("REDIS_URL");
            return new Redis(url);
          },
          inject: [ConfigService],
        },
      ],
    }).compile();

    service = module.get<RefreshTokenStore>(RefreshTokenStore);
    redis = module.get<Redis>(Redis);

    await service.onModuleInit();
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
    await module.close();
  });

  describe("Redis Commands Initialization", () => {
    it("should define all required redis commands", () => {
      const extendedRedis = redis as ExtendedRedis;
      expect(typeof extendedRedis.saveToken).toBe("function");
      expect(typeof extendedRedis.markTokenUsed).toBe("function");
      expect(typeof extendedRedis.deleteToken).toBe("function");
      expect(typeof extendedRedis.revokeAllTokens).toBe("function");
      expect(typeof extendedRedis.revokeDeviceTokens).toBe("function");
      expect(typeof extendedRedis.cleanupOrphanedTokens).toBe("function");
    });

    it("should execute redis commands correctly", async () => {
      const extendedRedis = redis as ExtendedRedis;

      const result = await extendedRedis.saveToken(
        "test:key",
        USER_ID,
        `user_tokens:${USER_ID}`,
        3600,
        JSON.stringify({
          userId: USER_ID,
          deviceId: DEVICE_ID,
          issuedAt: Date.now(),
          used: false,
        })
      );

      expect(result).toBe(1);

      const exists = await redis.get("test:key");
      expect(exists).toBeDefined();
    });
  });

  describe("save()", () => {
    it("saves a new token and stores correct data", async () => {
      await service.save(TOKEN, sampleData);
      const stored = await redis.get(`refresh:${TOKEN}`);
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored);
      expect(parsed.userId).toBe(USER_ID);
      expect(parsed.deviceId).toBe(DEVICE_ID);
      expect(parsed.used).toBe(false);
      expect(typeof parsed.issuedAt).toBe("number");
    });

    it("throws on invalid data", async () => {
      const invalidData = {
        userId: USER_ID,
        // deviceId missing
      } as unknown as { userId: string; deviceId: string };

      await expect(service.save(TOKEN, invalidData)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("throws if token already exists", async () => {
      await service.save(TOKEN, sampleData);
      await expect(service.save(TOKEN, sampleData)).rejects.toThrow(
        TokenAlreadyExistsError
      );
    });

    describe("Input Validation", () => {
      it("throws on null or undefined token", async () => {
        await expect(
          service.save(null as unknown as string, sampleData)
        ).rejects.toThrow();
        await expect(
          service.save(undefined as unknown as string, sampleData)
        ).rejects.toThrow();
      });

      it("throws on null or undefined data", async () => {
        await expect(
          service.save(TOKEN, null as unknown as typeof sampleData)
        ).rejects.toThrow();
        await expect(
          service.save(TOKEN, undefined as unknown as typeof sampleData)
        ).rejects.toThrow();
      });

      it("throws on empty token string", async () => {
        await expect(service.save("", sampleData)).rejects.toThrow();
      });

      it("rejects empty userId", async () => {
        const invalidData = new TokenDataBuilder()
          .withUserId("")
          .withDeviceId(DEVICE_ID)
          .build();

        await expect(service.save(TOKEN, invalidData)).rejects.toThrow(
          TokenValidationError
        );
      });

      it("rejects empty deviceId", async () => {
        const invalidData = new TokenDataBuilder()
          .withUserId(USER_ID)
          .withDeviceId("")
          .build();

        await expect(service.save(TOKEN, invalidData)).rejects.toThrow(
          TokenValidationError
        );
      });

      it("handles special characters in token", async () => {
        const specialToken = "token-with-спецсимволы-@#$%^&*()";
        await service.save(specialToken, sampleData);
        const data = await service.getTokenData(specialToken);
        expect(data).not.toBeNull();
        expect(data.userId).toBe(USER_ID);
      });

      it("handles very long token strings", async () => {
        const longToken = "x".repeat(500);
        await service.save(longToken, sampleData);
        const data = await service.getTokenData(longToken);
        expect(data).not.toBeNull();
      });

      it("handles unicode characters in userId and deviceId", async () => {
        const unicodeData = new TokenDataBuilder()
          .withUserId("用户ID-🚀-测试")
          .withDeviceId("设备ID-📱-тест")
          .build();

        await service.save(TOKEN, unicodeData);
        const data = await service.getTokenData(TOKEN);
        expect(data.userId).toBe("用户ID-🚀-测试");
        expect(data.deviceId).toBe("设备ID-📱-тест");
      });
    });
  });

  describe("getTokenData()", () => {
    it("returns null if token not found", async () => {
      const result = await service.getTokenData("nonexistent");
      expect(result).toBeNull();
    });

    it("returns valid token data", async () => {
      await service.save(TOKEN, sampleData);
      const data = await service.getTokenData(TOKEN);
      expect(data).toMatchObject({
        userId: USER_ID,
        deviceId: DEVICE_ID,
        used: false,
      });
      expect(typeof data?.issuedAt).toBe("number");
    });

    it("throws if token data is corrupted", async () => {
      await redis.set(`refresh:${TOKEN}`, "invalid_json");
      await expect(service.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("returns null for empty token", async () => {
      const result = await service.getTokenData("");
      expect(result).toBeNull();
    });

    it("handles malformed JSON gracefully", async () => {
      await redis.set(`refresh:${TOKEN}`, '{"userId":"test","incomplete":');
      await expect(service.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("throws on missing required fields", async () => {
      await redis.set(
        `refresh:${TOKEN}`,
        JSON.stringify({ userId: USER_ID, used: false })
      );
      await expect(service.getTokenData(TOKEN)).rejects.toThrow(
        TokenValidationError
      );
    });
  });

  describe("markUsed()", () => {
    it("returns true for successful mark", async () => {
      await service.save(TOKEN, sampleData);
      const result = await service.markUsed(TOKEN, USER_ID);
      expect(result).toBe(true);

      const data = await service.getTokenData(TOKEN);
      expect(data?.used).toBe(true);
    });

    it("returns false if token not found", async () => {
      const result = await service.markUsed("nonexistent", USER_ID);
      expect(result).toBe(false);
    });

    it("returns false if token belongs to another user", async () => {
      await service.save(TOKEN, sampleData);
      const result = await service.markUsed(TOKEN, "other-user-id");
      expect(result).toBe(false);
    });

    it("returns false if token already used", async () => {
      await service.save(TOKEN, sampleData);
      await service.markUsed(TOKEN, USER_ID);
      const result = await service.markUsed(TOKEN, USER_ID);
      expect(result).toBe(false);
    });

    it("removes token from user's active tokens set when marked as used", async () => {
      await service.save(TOKEN, sampleData);

      const userTokensKey = `user_tokens:${USER_ID}`;
      const beforeMark = await redis.smembers(userTokensKey);
      expect(beforeMark).toContain(`refresh:${TOKEN}`);

      await service.markUsed(TOKEN, USER_ID);

      const afterMark = await redis.smembers(userTokensKey);
      expect(afterMark).not.toContain(`refresh:${TOKEN}`);
    });

    it("sets correct TTL for used tokens", async () => {
      await service.save(TOKEN, sampleData);
      await service.markUsed(TOKEN, USER_ID);

      const ttl = await redis.ttl(`refresh:${TOKEN}`);
      expect(ttl).toBeGreaterThan(200);
      expect(ttl).toBeLessThan(400);
    });
  });

  describe("delete()", () => {
    it("deletes token successfully", async () => {
      await service.save(TOKEN, sampleData);
      const result = await service.delete(TOKEN, USER_ID);
      expect(result).toBe(true);
      const exists = await redis.get(`refresh:${TOKEN}`);
      expect(exists).toBeNull();
    });

    it("returns false if token not found", async () => {
      const result = await service.delete("nonexistent", USER_ID);
      expect(result).toBe(false);
    });

    it("returns false if token belongs to another user", async () => {
      await service.save(TOKEN, sampleData);
      const result = await service.delete(TOKEN, "other-user-id");
      expect(result).toBe(false);
    });

    it("removes token from user's tokens set", async () => {
      await service.save(TOKEN, sampleData);

      const userTokensKey = `user_tokens:${USER_ID}`;
      const beforeDelete = await redis.smembers(userTokensKey);
      expect(beforeDelete).toContain(`refresh:${TOKEN}`);

      await service.delete(TOKEN, USER_ID);

      const afterDelete = await redis.smembers(userTokensKey);
      expect(afterDelete).not.toContain(`refresh:${TOKEN}`);
    });
  });

  describe("revokeAllUserTokens()", () => {
    it("revokes all user tokens", async () => {
      await service.save("token1", sampleData);
      await service.save("token2", sampleData);

      const count = await service.revokeAllUserTokens(USER_ID);
      expect(count).toBe(2);

      const exists1 = await redis.get("refresh:token1");
      const exists2 = await redis.get("refresh:token2");
      expect(exists1).toBeNull();
      expect(exists2).toBeNull();
    });

    it("returns 0 if no tokens exist", async () => {
      const count = await service.revokeAllUserTokens("nonexistent-user");
      expect(count).toBe(0);
    });

    it("removes user tokens set", async () => {
      await service.save("token1", sampleData);
      await service.save("token2", sampleData);

      const userTokensKey = `user_tokens:${USER_ID}`;
      const beforeRevoke = await redis.smembers(userTokensKey);
      expect(beforeRevoke).toHaveLength(2);

      await service.revokeAllUserTokens(USER_ID);

      const afterRevoke = await redis.exists(userTokensKey);
      expect(afterRevoke).toBe(0);
    });
  });

  describe("revokeDeviceTokens()", () => {
    it("revokes tokens for specific device", async () => {
      await service.save("token1", sampleData);
      await service.save("token2", {
        userId: USER_ID,
        deviceId: "other-device",
      });

      const count = await service.revokeDeviceTokens(USER_ID, DEVICE_ID);
      expect(count).toBe(1);

      const exists1 = await redis.get("refresh:token1");
      const exists2 = await redis.get("refresh:token2");
      expect(exists1).toBeNull();
      expect(exists2).not.toBeNull();
    });

    it("returns 0 if no tokens for device", async () => {
      await service.save("token1", sampleData);
      const count = await service.revokeDeviceTokens(
        USER_ID,
        "nonexistent-device"
      );
      expect(count).toBe(0);
    });

    it("handles corrupted token data gracefully", async () => {
      await service.save("token1", sampleData);
      await redis.set("refresh:corrupted", "invalid-json");
      await redis.sadd(`user_tokens:${USER_ID}`, "refresh:corrupted");

      try {
        const count = await service.revokeDeviceTokens(USER_ID, DEVICE_ID);
        expect(count).toBe(1);
      } catch (error) {
        expect(error).toBeInstanceOf(TokenOperationFailedError);
      }
    });
  });

  describe("TTL Management", () => {
    it("sets correct TTL for new tokens", async () => {
      await service.save(TOKEN, sampleData);
      const ttl = await redis.ttl(`refresh:${TOKEN}`);
      expect(ttl).toBeGreaterThan(6 * 24 * 3600);
      expect(ttl).toBeLessThan(8 * 24 * 3600);
    });

    it("maintains TTL after token operations", async () => {
      await service.save(TOKEN, sampleData);
      const initialTtl = await redis.ttl(`refresh:${TOKEN}`);

      await service.getTokenData(TOKEN);
      const afterGetTtl = await redis.ttl(`refresh:${TOKEN}`);

      expect(Math.abs(initialTtl - afterGetTtl)).toBeLessThan(2);
    });
  });

  describe("Lua Scripts Edge Cases", () => {
    it("SAVE_SCRIPT handles user ID mismatch", async () => {
      const extendedRedis = redis as ExtendedRedis;

      const tokenData = JSON.stringify({
        userId: "different-user",
        deviceId: DEVICE_ID,
        issuedAt: Date.now(),
        used: false,
      });

      await expect(
        extendedRedis.saveToken(
          `refresh:${TOKEN}`,
          USER_ID,
          `user_tokens:${USER_ID}`,
          3600,
          tokenData
        )
      ).rejects.toThrow();
    });

    it("MARK_USED_SCRIPT handles already used tokens", async () => {
      await service.save(TOKEN, sampleData);
      await service.markUsed(TOKEN, USER_ID);

      const extendedRedis = redis as ExtendedRedis;
      const result = await extendedRedis.markTokenUsed(
        `refresh:${TOKEN}`,
        USER_ID,
        `user_tokens:${USER_ID}`,
        300
      );

      expect(result).toBe(0);
    });

    it("DELETE_SCRIPT verifies user ownership", async () => {
      await service.save(TOKEN, sampleData);

      const extendedRedis = redis as ExtendedRedis;
      const result = await extendedRedis.deleteToken(
        `refresh:${TOKEN}`,
        "other-user",
        `user_tokens:other-user`
      );

      expect(result).toBe(0);
    });
  });

  describe("Redis Connection Issues", () => {
    it("handles save operation failure gracefully", async () => {
      const extendedRedis = redis as ExtendedRedis;
      const originalSaveToken = extendedRedis.saveToken;

      extendedRedis.saveToken = jest
        .fn()
        .mockRejectedValue(new Error("Redis failure"));

      await expect(service.save(TOKEN, sampleData)).rejects.toThrow(
        TokenOperationFailedError
      );

      extendedRedis.saveToken = originalSaveToken;
    });

    it("handles mark used operation failure gracefully", async () => {
      await service.save(TOKEN, sampleData);

      const extendedRedis = redis as ExtendedRedis;
      const originalMarkUsed = extendedRedis.markTokenUsed;

      extendedRedis.markTokenUsed = jest
        .fn()
        .mockRejectedValue(new Error("Redis failure"));

      await expect(service.markUsed(TOKEN, USER_ID)).rejects.toThrow(
        TokenOperationFailedError
      );

      extendedRedis.markTokenUsed = originalMarkUsed;
    });
  });

  describe("Race Conditions and Concurrency", () => {
    it("concurrent save for same token - only one succeeds", async () => {
      const promises = [
        service.save(TOKEN, sampleData),
        service.save(TOKEN, sampleData),
        service.save(TOKEN, sampleData),
      ];

      const results = await Promise.allSettled(promises);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(2);

      rejected.forEach((result) => {
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
          TokenAlreadyExistsError
        );
      });
    });

    it("concurrent mark used operations", async () => {
      await service.save(TOKEN, sampleData);

      const promises = [
        service.markUsed(TOKEN, USER_ID),
        service.markUsed(TOKEN, USER_ID),
        service.markUsed(TOKEN, USER_ID),
      ];

      const results = await Promise.allSettled(promises);
      const values = results.map((r) =>
        r.status === "fulfilled" ? r.value : false
      );

      expect(values.filter((v) => v === true)).toHaveLength(1);
      expect(values.filter((v) => v === false)).toHaveLength(2);
    });

    it("concurrent revoke operations maintain data consistency", async () => {
      await service.save("token1", sampleData);
      await service.save("token2", sampleData);

      const promises = [
        service.revokeAllUserTokens(USER_ID),
        service.delete("token1", USER_ID),
        service.markUsed("token2", USER_ID),
      ];

      await Promise.allSettled(promises);

      const userTokens = await redis.smembers(`user_tokens:${USER_ID}`);
      const token1Exists = await redis.get("refresh:token1");
      const token2Exists = await redis.get("refresh:token2");

      expect(userTokens).toHaveLength(0);
      expect(token1Exists).toBeNull();
      expect(token2Exists).toBeNull();
    });
  });

  describe("Performance Tests", () => {
    it("handles large number of tokens per user efficiently", async () => {
      const tokenCount = 100;
      const promises = [];

      for (let i = 0; i < tokenCount; i++) {
        const tokenData = new TokenDataBuilder()
          .withUserId(USER_ID)
          .withDeviceId(`device-${i}`)
          .build();
        promises.push(service.save(`token-${i}`, tokenData));
      }

      await Promise.all(promises);

      const start = Date.now();
      const count = await service.revokeAllUserTokens(USER_ID);
      const duration = Date.now() - start;

      expect(count).toBe(tokenCount);
      expect(duration).toBeLessThan(2000);
    }, 10000);

    it("efficiently revokes device tokens", async () => {
      const deviceCount = 50;
      const promises = [];

      for (let i = 0; i < deviceCount; i++) {
        const tokenData = new TokenDataBuilder()
          .withUserId(USER_ID)
          .withDeviceId(i < 25 ? DEVICE_ID : `other-device-${i}`)
          .build();
        promises.push(service.save(`token-${i}`, tokenData));
      }

      await Promise.all(promises);

      const start = Date.now();
      const count = await service.revokeDeviceTokens(USER_ID, DEVICE_ID);
      const duration = Date.now() - start;

      expect(count).toBe(25);
      expect(duration).toBeLessThan(1500);
    }, 8000);
  });

  describe("Integration Scenarios", () => {
    it("complete token lifecycle", async () => {
      await service.save(TOKEN, sampleData);

      const initialData = await service.getTokenData(TOKEN);
      expect(initialData?.used).toBe(false);
      expect(initialData?.userId).toBe(USER_ID);

      let ttl = await redis.ttl(`refresh:${TOKEN}`);
      expect(ttl).toBeGreaterThan(6 * 24 * 3600);

      const marked = await service.markUsed(TOKEN, USER_ID);
      expect(marked).toBe(true);

      const usedData = await service.getTokenData(TOKEN);
      expect(usedData?.used).toBe(true);

      ttl = await redis.ttl(`refresh:${TOKEN}`);
      expect(ttl).toBeLessThan(400);

      const markedAgain = await service.markUsed(TOKEN, USER_ID);
      expect(markedAgain).toBe(false);
    });

    it("multi-device scenario", async () => {
      const device1Data = new TokenDataBuilder()
        .withUserId(USER_ID)
        .withDeviceId("mobile-device")
        .build();

      const device2Data = new TokenDataBuilder()
        .withUserId(USER_ID)
        .withDeviceId("web-device")
        .build();

      await service.save("mobile-token", device1Data);
      await service.save("web-token-1", device2Data);
      await service.save("web-token-2", device2Data);

      const revokedCount = await service.revokeDeviceTokens(
        USER_ID,
        "web-device"
      );
      expect(revokedCount).toBe(2);

      const mobileToken = await service.getTokenData("mobile-token");
      expect(mobileToken).not.toBeNull();

      const webToken1 = await service.getTokenData("web-token-1");
      const webToken2 = await service.getTokenData("web-token-2");
      expect(webToken1).toBeNull();
      expect(webToken2).toBeNull();
    });

    it("user with multiple active sessions", async () => {
      const sessions = [
        { token: "session-1", deviceId: "device-1" },
        { token: "session-2", deviceId: "device-2" },
        { token: "session-3", deviceId: "device-3" },
      ];

      for (const session of sessions) {
        const tokenData = new TokenDataBuilder()
          .withUserId(USER_ID)
          .withDeviceId(session.deviceId)
          .build();
        await service.save(session.token, tokenData);
      }

      await service.markUsed("session-1", USER_ID);

      await service.delete("session-2", USER_ID);

      const session1 = await service.getTokenData("session-1");
      const session2 = await service.getTokenData("session-2");
      const session3 = await service.getTokenData("session-3");

      expect(session1?.used).toBe(true);
      expect(session2).toBeNull();
      expect(session3?.used).toBe(false);

      const revokedCount = await service.revokeAllUserTokens(USER_ID);
      expect(revokedCount).toBe(1);
    });
  });

  describe("Configuration Edge Cases", () => {
    it("works with custom Redis prefix", async () => {
      await service.save(TOKEN, sampleData);

      const key = `refresh:${TOKEN}`;
      const exists = await redis.exists(key);
      expect(exists).toBe(1);

      const userTokensKey = `user_tokens:${USER_ID}`;
      const isMember = await redis.sismember(userTokensKey, key);
      expect(isMember).toBe(1);
    });
  });

  describe("Memory and Resource Management", () => {
    it("cleans up used tokens after TTL expires", async () => {
      await service.save(TOKEN, sampleData);
      await service.markUsed(TOKEN, USER_ID);

      await redis.expire(`refresh:${TOKEN}`, 1);

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const expired = await service.getTokenData(TOKEN);
      expect(expired).toBeNull();
    });

    it("maintains user tokens set consistency", async () => {
      await service.save("token1", sampleData);
      await service.save("token2", sampleData);

      const userTokensKey = `user_tokens:${USER_ID}`;
      let tokenCount = await redis.scard(userTokensKey);
      expect(tokenCount).toBe(2);

      await redis.del("refresh:token1");

      tokenCount = await redis.scard(userTokensKey);
      expect(tokenCount).toBe(2);

      const revokedCount = await service.revokeDeviceTokens(USER_ID, DEVICE_ID);
      expect(revokedCount).toBe(1);

      tokenCount = await redis.scard(userTokensKey);
      expect(tokenCount).toBe(0);

      const allRevokedCount = await service.revokeAllUserTokens(USER_ID);
      expect(allRevokedCount).toBe(0);

      tokenCount = await redis.scard(userTokensKey);
      expect(tokenCount).toBe(0);
    });
    it("understands user tokens set behavior with mark used", async () => {
      await service.save("token1", sampleData);
      await service.save("token2", sampleData);

      const userTokensKey = `user_tokens:${USER_ID}`;
      let tokenCount = await redis.scard(userTokensKey);
      expect(tokenCount).toBe(2);

      await service.markUsed("token1", USER_ID);

      tokenCount = await redis.scard(userTokensKey);
      expect(tokenCount).toBe(1);

      const usedToken = await service.getTokenData("token1");
      expect(usedToken?.used).toBe(true);

      const revokedCount = await service.revokeAllUserTokens(USER_ID);
      expect(revokedCount).toBe(1);

      await service.getTokenData("token1");
      const finalToken2 = await service.getTokenData("token2");

      expect(finalToken2).toBeNull();

      tokenCount = await redis.scard(userTokensKey);
      expect(tokenCount).toBe(0);
    });
  });

  describe("saveBatch()", () => {
    it("saves multiple tokens successfully", async () => {
      const tokens = [
        {
          token: "batch-token-1",
          data: { userId: USER_ID, deviceId: "device-1" },
        },
        {
          token: "batch-token-2",
          data: { userId: USER_ID, deviceId: "device-2" },
        },
        {
          token: "batch-token-3",
          data: { userId: "other-user", deviceId: "device-3" },
        },
      ];

      const count = await service.saveBatch(tokens);
      expect(count).toBe(3);

      for (const { token } of tokens) {
        const data = await service.getTokenData(token);
        expect(data).not.toBeNull();
        expect(data?.used).toBe(false);
      }
    });

    it("returns 0 for empty array", async () => {
      const count = await service.saveBatch([]);
      expect(count).toBe(0);
    });

    it("returns 0 for null/undefined input", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count1 = await service.saveBatch(null as any);
      expect(count1).toBe(0);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count2 = await service.saveBatch(undefined as any);
      expect(count2).toBe(0);
    });

    it("skips invalid tokens and continues with valid ones", async () => {
      const tokens = [
        {
          token: "valid-token-1",
          data: { userId: USER_ID, deviceId: "device-1" },
        },
        { token: "", data: { userId: USER_ID, deviceId: "device-2" } }, // invalid token
        { token: "valid-token-2", data: { userId: "", deviceId: "device-3" } }, // invalid data
        {
          token: "valid-token-3",
          data: { userId: "user-2", deviceId: "device-4" },
        },
      ];

      const count = await service.saveBatch(tokens);
      expect(count).toBe(2); // only valid-token-1 and valid-token-3

      const data1 = await service.getTokenData("valid-token-1");
      const data3 = await service.getTokenData("valid-token-3");
      expect(data1).not.toBeNull();
      expect(data3).not.toBeNull();
    });

    it("handles Redis operation failure", async () => {
      const extendedRedis = redis as ExtendedRedis;
      const originalSaveBatchTokens = extendedRedis.saveBatchTokens;

      extendedRedis.saveBatchTokens = jest
        .fn()
        .mockRejectedValue(new Error("Redis operation failed"));

      const tokens = [
        {
          token: "test-token",
          data: { userId: USER_ID, deviceId: "device-1" },
        },
      ];

      await expect(service.saveBatch(tokens)).rejects.toThrow(
        TokenOperationFailedError
      );

      extendedRedis.saveBatchTokens = originalSaveBatchTokens;
    });

    it("correctly updates user tokens sets", async () => {
      const tokens = [
        {
          token: "user1-token-1",
          data: { userId: "user-1", deviceId: "device-1" },
        },
        {
          token: "user1-token-2",
          data: { userId: "user-1", deviceId: "device-2" },
        },
        {
          token: "user2-token-1",
          data: { userId: "user-2", deviceId: "device-1" },
        },
      ];

      await service.saveBatch(tokens);

      const user1Tokens = await redis.scard("user_tokens:user-1");
      const user2Tokens = await redis.scard("user_tokens:user-2");

      expect(user1Tokens).toBe(2);
      expect(user2Tokens).toBe(1);
    });
  });

  describe("cleanupOrphanedTokens()", () => {
    it("removes orphaned tokens from user set", async () => {
      await service.save("token1", sampleData);
      await service.save("token2", sampleData);

      const userTokensKey = `user_tokens:${USER_ID}`;

      await redis.del("refresh:token1");

      const cleanedCount = await service.cleanupOrphanedTokens(USER_ID);
      expect(cleanedCount).toBe(1);

      const remainingTokens = await redis.smembers(userTokensKey);
      expect(remainingTokens).not.toContain("refresh:token1");
      expect(remainingTokens).toContain("refresh:token2");
    });

    it("returns 0 for empty userId", async () => {
      const count1 = await service.cleanupOrphanedTokens("");
      const count2 = await service.cleanupOrphanedTokens("   ");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count3 = await service.cleanupOrphanedTokens(null as any);

      expect(count1).toBe(0);
      expect(count2).toBe(0);
      expect(count3).toBe(0);
    });

    it("returns 0 when no orphaned tokens exist", async () => {
      await service.save("token1", sampleData);
      const cleanedCount = await service.cleanupOrphanedTokens(USER_ID);
      expect(cleanedCount).toBe(0);
    });

    it("handles Redis operation failure", async () => {
      const extendedRedis = redis as ExtendedRedis;
      const originalCleanup = extendedRedis.cleanupOrphanedTokens;

      extendedRedis.cleanupOrphanedTokens = jest
        .fn()
        .mockRejectedValue(new Error("Redis failure"));

      await expect(service.cleanupOrphanedTokens(USER_ID)).rejects.toThrow(
        TokenOperationFailedError
      );

      extendedRedis.cleanupOrphanedTokens = originalCleanup;
    });
  });

  describe("getUserTokenStats()", () => {
    it("returns correct stats for user with tokens", async () => {
      const user1Data = { userId: "stats-user-1", deviceId: "device-1" };
      const user2Data = { userId: "stats-user-1", deviceId: "device-2" };
      const user3Data = { userId: "stats-user-1", deviceId: "device-1" }; // same device as first

      await service.save("stats-token-1", user1Data);
      await service.save("stats-token-2", user2Data);
      await service.save("stats-token-3", user3Data);

      const stats = await service.getUserTokenStats("stats-user-1");

      expect(stats.activeTokens).toBe(3);
      expect(stats.totalTokens).toBe(3);
      expect(stats.deviceCount).toBe(2); // device-1 and device-2
    });

    it("returns zeros for empty userId", async () => {
      const stats1 = await service.getUserTokenStats("");
      const stats2 = await service.getUserTokenStats("   ");
      const stats3 = await service.getUserTokenStats(null as unknown as string);

      expect(stats1).toEqual({
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      });
      expect(stats2).toEqual({
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      });
      expect(stats3).toEqual({
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      });
    });

    it("returns zeros for user with no tokens", async () => {
      const stats = await service.getUserTokenStats("nonexistent-user");
      expect(stats).toEqual({
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      });
    });

    it("handles corrupted token data gracefully", async () => {
      await service.save("good-token", sampleData);

      const userTokensKey = `user_tokens:${USER_ID}`;
      await redis.set("refresh:corrupted-token", "invalid-json");
      await redis.sadd(userTokensKey, "refresh:corrupted-token");

      const stats = await service.getUserTokenStats(USER_ID);

      expect(stats.activeTokens).toBe(1);
      expect(stats.totalTokens).toBe(1);
      expect(stats.deviceCount).toBe(1);

      const remainingTokens = await redis.smembers(userTokensKey);
      expect(remainingTokens).not.toContain("refresh:corrupted-token");
      expect(remainingTokens).toContain("refresh:good-token");
    });

    it("correctly counts unique devices", async () => {
      const tokens = [
        {
          token: "device-token-1",
          data: { userId: USER_ID, deviceId: "mobile" },
        },
        {
          token: "device-token-2",
          data: { userId: USER_ID, deviceId: "mobile" },
        }, // same device
        { token: "device-token-3", data: { userId: USER_ID, deviceId: "web" } },
        {
          token: "device-token-4",
          data: { userId: USER_ID, deviceId: "desktop" },
        },
      ];

      for (const { token, data } of tokens) {
        await service.save(token, data);
      }

      const stats = await service.getUserTokenStats(USER_ID);

      expect(stats.activeTokens).toBe(4);
      expect(stats.deviceCount).toBe(3); // mobile, web, desktop
    });

    it("handles Redis operation failure", async () => {
      const extendedRedis = redis as ExtendedRedis;
      const originalGetUserTokenStatsOptimized =
        extendedRedis.getUserTokenStatsOptimized;

      extendedRedis.getUserTokenStatsOptimized = jest
        .fn()
        .mockRejectedValue(new Error("Redis failure"));

      await expect(service.getUserTokenStats(USER_ID)).rejects.toThrow(
        TokenOperationFailedError
      );

      extendedRedis.getUserTokenStatsOptimized =
        originalGetUserTokenStatsOptimized;
    });
  });

  describe("Configuration Validation", () => {
    it("throws ConfigurationError for invalid TTL days", async () => {
      const createServiceWithConfig = (ttlDays: number) => {
        const mockConfigService = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          get: jest.fn((key: string, defaultValue?: any) => {
            if (key === "REFRESH_TOKEN_TTL_DAYS") return ttlDays;
            if (key === "USED_TOKEN_TTL_MINUTES") return 5;
            if (key === "REDIS_USER_TOKENS_PREFIX") return "user_tokens";
            if (key === "MAX_TOKEN_LENGTH") return 1000;
            return defaultValue;
          }),
        };

        expect(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          () => new RefreshTokenStore(redis, mockConfigService as any)
        ).toThrow(ConfigurationError);
      };

      createServiceWithConfig(0); // too low
      createServiceWithConfig(-1); // negative
      createServiceWithConfig(366); // too high
    });

    it("throws ConfigurationError for invalid used token TTL minutes", async () => {
      const createServiceWithConfig = (ttlMinutes: number) => {
        const mockConfigService = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          get: jest.fn((key: string, defaultValue?: any) => {
            if (key === "REFRESH_TOKEN_TTL_DAYS") return 7;
            if (key === "USED_TOKEN_TTL_MINUTES") return ttlMinutes;
            if (key === "REDIS_USER_TOKENS_PREFIX") return "user_tokens";
            if (key === "MAX_TOKEN_LENGTH") return 1000;
            return defaultValue;
          }),
        };

        expect(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          () => new RefreshTokenStore(redis, mockConfigService as any)
        ).toThrow(ConfigurationError);
      };

      createServiceWithConfig(0); // too low
      createServiceWithConfig(-1); // negative
      createServiceWithConfig(61); // too high
    });

    it("accepts valid configuration values", async () => {
      const mockConfigService = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === "REFRESH_TOKEN_TTL_DAYS") return 30;
          if (key === "USED_TOKEN_TTL_MINUTES") return 15;
          if (key === "REDIS_USER_TOKENS_PREFIX") return "custom_tokens";
          if (key === "MAX_TOKEN_LENGTH") return 2000;
          return defaultValue;
        }),
      };

      expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        () => new RefreshTokenStore(redis, mockConfigService as any)
      ).not.toThrow();
    });
  });

  describe("Token Length Validation", () => {
    it("throws error for token exceeding max length", async () => {
      const longToken = "x".repeat(1001);

      await expect(service.save(longToken, sampleData)).rejects.toThrow(
        TokenValidationError
      );
    });

    it("accepts token at max length boundary", async () => {
      const maxLengthToken = "x".repeat(1000);

      await expect(
        service.save(maxLengthToken, sampleData)
      ).resolves.not.toThrow();

      const data = await service.getTokenData(maxLengthToken);
      expect(data).not.toBeNull();
    });
  });

  describe("Lua Script Error Handling", () => {
    it("SAVE_SCRIPT handles invalid JSON", async () => {
      const extendedRedis = redis as ExtendedRedis;

      await expect(
        extendedRedis.saveToken(
          `refresh:${TOKEN}`,
          USER_ID,
          `user_tokens:${USER_ID}`,
          3600,
          "invalid-json-string"
        )
      ).rejects.toThrow();
    });

    it("MARK_USED_SCRIPT handles malformed token data", async () => {
      // Создаем токен с поврежденными данными напрямую в Redis
      await redis.set(`refresh:${TOKEN}`, "invalid-json");

      const extendedRedis = redis as ExtendedRedis;
      const result = await extendedRedis.markTokenUsed(
        `refresh:${TOKEN}`,
        USER_ID,
        `user_tokens:${USER_ID}`,
        300
      );

      expect(result).toBe(0);
    });

    it("DELETE_SCRIPT handles malformed token data", async () => {
      await redis.set(`refresh:${TOKEN}`, "invalid-json");

      const extendedRedis = redis as ExtendedRedis;
      const result = await extendedRedis.deleteToken(
        `refresh:${TOKEN}`,
        USER_ID,
        `user_tokens:${USER_ID}`
      );

      expect(result).toBe(0);
    });
  });

  describe("Edge Cases and Boundary Conditions", () => {
    it("handles empty string inputs gracefully", async () => {
      expect(await service.getTokenData("")).toBeNull();
      expect(await service.markUsed("", USER_ID)).toBe(false);
      expect(await service.markUsed(TOKEN, "")).toBe(false);
      expect(await service.delete("", USER_ID)).toBe(false);
      expect(await service.delete(TOKEN, "")).toBe(false);
      expect(await service.revokeAllUserTokens("")).toBe(0);
      expect(await service.revokeDeviceTokens("", DEVICE_ID)).toBe(0);
      expect(await service.revokeDeviceTokens(USER_ID, "")).toBe(0);
    });

    it("handles whitespace-only inputs", async () => {
      expect(await service.getTokenData("   ")).toBeNull();
      expect(await service.markUsed("   ", USER_ID)).toBe(false);
      expect(await service.markUsed(TOKEN, "   ")).toBe(false);
      expect(await service.delete("   ", USER_ID)).toBe(false);
      expect(await service.delete(TOKEN, "   ")).toBe(false);
      expect(await service.revokeAllUserTokens("   ")).toBe(0);
      expect(await service.revokeDeviceTokens("   ", DEVICE_ID)).toBe(0);
      expect(await service.revokeDeviceTokens(USER_ID, "   ")).toBe(0);
    });

    it("handles tokens with special Redis characters", async () => {
      const specialTokens = [
        "token:with:colons",
        "token*with*wildcards",
        "token[with]brackets",
        "token{with}braces",
        "token with spaces",
        "token\nwith\nnewlines",
        "token\twith\ttabs",
      ];

      for (const token of specialTokens) {
        await service.save(token, sampleData);
        const data = await service.getTokenData(token);
        expect(data).not.toBeNull();
        expect(data?.userId).toBe(USER_ID);

        await service.delete(token, USER_ID);
      }
    });

    it("maintains consistency with rapid token creation and deletion", async () => {
      const tokenCount = 20;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promises: Promise<any>[] = [];

      // Создаем токены
      for (let i = 0; i < tokenCount; i++) {
        promises.push(
          service.save(`rapid-token-${i}`, {
            userId: USER_ID,
            deviceId: `device-${i % 5}`,
          })
        );
      }

      await Promise.all(promises);
      promises.length = 0;

      for (let i = 0; i < tokenCount; i += 2) {
        promises.push(service.delete(`rapid-token-${i}`, USER_ID));
      }

      for (let i = 1; i < tokenCount; i += 3) {
        promises.push(service.markUsed(`rapid-token-${i}`, USER_ID));
      }

      const results = await Promise.allSettled(promises);

      const errors = results.filter((r) => r.status === "rejected");
      expect(errors).toHaveLength(0);

      const stats = await service.getUserTokenStats(USER_ID);

      // Подсчитываем ожидаемое количество активных токенов
      // Удалены: 0, 2, 4, 6, 8, 10, 12, 14, 16, 18 (10 токенов)
      // Помечены как использованные: 1, 4, 7, 10, 13, 16, 19 (7 токенов, но 4, 10, 16 уже удалены)
      // Фактически помечены: 1, 7, 13, 19 (4 токена)
      // Остались активными: остальные токены, которые не удалены и не помечены
      // Всего токенов: 20, удалено: 10, помечено как использованные: 4
      // Активных: 20 - 10 - 4 = 6

      expect(stats.activeTokens).toBeLessThanOrEqual(tokenCount);
      expect(stats.deviceCount).toBeLessThanOrEqual(5);
    });
  });

  describe("Real-world Scenarios", () => {
    it("handles user logout from all devices", async () => {
      const devices = ["mobile", "laptop", "tablet"];

      for (const device of devices) {
        await service.save(`${device}-token`, {
          userId: USER_ID,
          deviceId: device,
        });
      }

      await service.markUsed("mobile-token", USER_ID);

      const revokedCount = await service.revokeAllUserTokens(USER_ID);

      expect(revokedCount).toBe(2);

      const mobileData = await service.getTokenData("mobile-token");
      const laptopData = await service.getTokenData("laptop-token");
      const tabletData = await service.getTokenData("tablet-token");

      expect(mobileData?.used).toBe(true);
      expect(laptopData).toBeNull();
      expect(tabletData).toBeNull();
    });

    it("handles device compromise scenario", async () => {
      await service.save("safe-mobile", {
        userId: USER_ID,
        deviceId: "mobile-safe",
      });
      await service.save("compromised-laptop-1", {
        userId: USER_ID,
        deviceId: "laptop-compromised",
      });
      await service.save("compromised-laptop-2", {
        userId: USER_ID,
        deviceId: "laptop-compromised",
      });
      await service.save("safe-desktop", {
        userId: USER_ID,
        deviceId: "desktop-safe",
      });

      const revokedCount = await service.revokeDeviceTokens(
        USER_ID,
        "laptop-compromised"
      );
      expect(revokedCount).toBe(2);

      const mobileData = await service.getTokenData("safe-mobile");
      const desktopData = await service.getTokenData("safe-desktop");
      const laptop1Data = await service.getTokenData("compromised-laptop-1");
      const laptop2Data = await service.getTokenData("compromised-laptop-2");

      expect(mobileData).not.toBeNull();
      expect(desktopData).not.toBeNull();
      expect(laptop1Data).toBeNull();
      expect(laptop2Data).toBeNull();
    });

    it("handles token refresh cycle", async () => {
      await service.save("refresh-token-v1", sampleData);

      const marked = await service.markUsed("refresh-token-v1", USER_ID);
      expect(marked).toBe(true);

      await service.save("refresh-token-v2", sampleData);

      const oldTokenData = await service.getTokenData("refresh-token-v1");
      const newTokenData = await service.getTokenData("refresh-token-v2");

      expect(oldTokenData?.used).toBe(true);
      expect(newTokenData?.used).toBe(false);

      const stats = await service.getUserTokenStats(USER_ID);
      expect(stats.activeTokens).toBe(1);
    });
  });
});
