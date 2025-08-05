import { Test, TestingModule } from "@nestjs/testing";
import { Redis } from "ioredis";
import { getRedisConnectionToken } from "@nestjs-modules/ioredis";
import { RefreshTokenStore } from "./refresh-token.store";
import { TokenValidator } from "./validator/token-validator";
import { RedisTokenRepository } from "./repository/redis-token-repository";
import { TokenStatsService } from "./stats/token-stats.service";
import { TokenCleanupService } from "./cleanup/token-cleanup.service";
import { RefreshTokenStoreConfiguration } from "./refresh-token.types";

describe("RefreshTokenStore Integration", () => {
  let service: RefreshTokenStore;
  let redis: Redis;
  let module: TestingModule;
  let redisRepository: RedisTokenRepository;

  const TOKEN = "test-token";
  const USER_ID = "user-id";
  const DEVICE_ID = "device-id";

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

  beforeAll(async () => {
    const mockRedis = new Redis("redis://127.0.0.1:6379");

    module = await Test.createTestingModule({
      providers: [
        RefreshTokenStore,
        TokenValidator,
        {
          provide: "REFRESH_TOKEN_STORE_CONFIG",
          useValue: mockConfig,
        },
        {
          provide: RedisTokenRepository,
          useFactory: async (redis: Redis) => {
            const repo = new RedisTokenRepository(redis, mockConfig);
            await repo.onModuleInit();
            return repo;
          },
          inject: [getRedisConnectionToken()],
        },
        {
          provide: TokenStatsService,
          useFactory: (repository: RedisTokenRepository) =>
            new TokenStatsService(repository, mockConfig),
          inject: [RedisTokenRepository],
        },
        {
          provide: TokenCleanupService,
          useFactory: (repository: RedisTokenRepository) =>
            new TokenCleanupService(repository, mockConfig),
          inject: [RedisTokenRepository],
        },
        {
          provide: getRedisConnectionToken(),
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<RefreshTokenStore>(RefreshTokenStore);
    redisRepository = module.get<RedisTokenRepository>(RedisTokenRepository);
    redis = module.get<Redis>(getRedisConnectionToken());
  });

  beforeEach(async () => {
    await redis.flushdb();
    await redisRepository.onModuleInit();
  });

  afterAll(async () => {
    await redis.quit();
    await module.close();
  });

  describe("Integration Scenarios", () => {
    it("complete token lifecycle", async () => {
      // 1. Save new token
      await service.save(TOKEN, {
        userId: USER_ID,
        deviceId: DEVICE_ID,
      });

      // 2. Verify token exists and is active
      const initialData = await service.getTokenData(TOKEN);
      expect(initialData).toBeDefined();
      expect(initialData?.used).toBe(false);
      expect(initialData?.userId).toBe(USER_ID);

      // 3. Mark token as used
      const marked = await service.markUsed(TOKEN, USER_ID);
      expect(marked).toBe(true);

      // 4. Verify token is marked as used
      const usedData = await service.getTokenData(TOKEN);
      expect(usedData?.used).toBe(true);

      // 5. Delete token
      const deleted = await service.delete(TOKEN, USER_ID);
      expect(deleted).toBe(true);

      // 6. Verify token is deleted
      const finalCheck = await service.getTokenData(TOKEN);
      expect(finalCheck).toBeNull();
    });

    it("multi-device scenario", async () => {
      // 1. Create tokens for different devices
      await service.save("mobile-token", {
        userId: USER_ID,
        deviceId: "mobile",
      });
      await service.save("web-token", {
        userId: USER_ID,
        deviceId: "web",
      });

      // 2. Verify both tokens exist
      expect(await service.getTokenData("mobile-token")).toBeDefined();
      expect(await service.getTokenData("web-token")).toBeDefined();

      // 3. Revoke web device tokens
      const revoked = await service.revokeDeviceTokens(USER_ID, "web");
      expect(revoked).toBe(1);

      // 4. Verify web token is revoked but mobile remains
      expect(await service.getTokenData("mobile-token")).not.toBeNull();
      expect(await service.getTokenData("web-token")).toBeNull();
    });

    it("user logout from all devices", async () => {
      // 1. Create multiple tokens
      await service.save("token1", { userId: USER_ID, deviceId: "device1" });
      await service.save("token2", { userId: USER_ID, deviceId: "device2" });

      // 2. Verify device limit check passes
      const statsBefore = await service.getUserTokenStats(USER_ID);
      expect(statsBefore.deviceCount).toBe(2);

      // 3. Revoke all tokens
      const revokedCount = await service.revokeAllUserTokens(USER_ID);
      expect(revokedCount).toBe(2);

      // 4. Verify all tokens are gone
      expect(await service.getTokenData("token1")).toBeNull();
      expect(await service.getTokenData("token2")).toBeNull();

      // 5. Verify stats are updated
      const statsAfter = await service.getUserTokenStats(USER_ID);
      expect(statsAfter.deviceCount).toBe(0);
    });
  });
});
