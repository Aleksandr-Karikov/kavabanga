import { Test, TestingModule } from "@nestjs/testing";
import { TokenStatsService } from "./token-stats.service";
import { RedisTokenRepository } from "../repository/redis-token-repository";
import { RefreshTokenStoreConfiguration } from "../refresh-token.types";
import { TokenOperationFailedError } from "../refresh-token.types";
import { Logger } from "@nestjs/common";

describe("TokenStatsService", () => {
  let service: TokenStatsService;
  let mockRepository: jest.Mocked<RedisTokenRepository>;
  let loggerSpy: jest.SpyInstance;

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

  beforeEach(async () => {
    mockRepository = {
      getUserStatsKey: jest
        .fn()
        .mockImplementation((userId) => `stats:${userId}`),
      getUserTokenStatsOptimized: jest.fn(),
      deleteKey: jest.fn(),
    } as unknown as jest.Mocked<RedisTokenRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenStatsService,
        {
          provide: RedisTokenRepository,
          useValue: mockRepository,
        },
        {
          provide: "REFRESH_TOKEN_STORE_CONFIG",
          useValue: mockConfig,
        },
      ],
    }).compile();

    service = module.get<TokenStatsService>(TokenStatsService);
    loggerSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerSpy.mockRestore();
  });

  describe("getUserTokenStats", () => {
    it("should return empty stats for empty userId", async () => {
      const result = await service.getUserTokenStats("");
      expect(result).toEqual({
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      });
    });

    it("should return stats from repository", async () => {
      mockRepository.getUserTokenStatsOptimized.mockResolvedValue([
        5,
        10,
        ["dev1", "dev2"],
      ]);

      const result = await service.getUserTokenStats("user1");
      expect(result).toEqual({
        activeTokens: 5,
        totalTokens: 10,
        deviceCount: 2,
      });
    });

    it("should log warning for excessive tokens", async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => {});
      mockRepository.getUserTokenStatsOptimized.mockResolvedValue([
        150,
        250,
        ["dev1", "dev2"],
      ]);

      await service.getUserTokenStats("user1");
      expect(warnSpy).toHaveBeenCalledWith(
        "User has excessive number of tokens",
        {
          userId: "user1",
          totalTokens: 250,
          activeTokens: 150,
          deviceCount: 2,
        }
      );
      warnSpy.mockRestore();
    });

    it("should throw TokenOperationFailedError on repository error", async () => {
      mockRepository.getUserTokenStatsOptimized.mockRejectedValue(
        new Error("DB error")
      );

      await expect(service.getUserTokenStats("user1")).rejects.toThrow(
        TokenOperationFailedError
      );
      expect(loggerSpy).toHaveBeenCalled();
    });

    it("should use default options when none provided", async () => {
      mockRepository.getUserTokenStatsOptimized.mockResolvedValue([
        1,
        1,
        ["dev1"],
      ]);

      await service.getUserTokenStats("user1");
      expect(mockRepository.getUserTokenStatsOptimized).toHaveBeenCalledWith(
        "user1",
        100, // default maxBatchSize
        "stats:user1", // stats key from getUserStatsKey
        300 // default statsCacheTtl
      );
    });

    it("should override default options when provided", async () => {
      mockRepository.getUserTokenStatsOptimized.mockResolvedValue([
        1,
        1,
        ["dev1"],
      ]);

      await service.getUserTokenStats("user1", {
        enableCaching: false,
        maxBatchSize: 50,
        statsCacheTtl: 100,
      });

      expect(mockRepository.getUserTokenStatsOptimized).toHaveBeenCalledWith(
        "user1",
        50,
        "", // empty stats key when caching disabled
        100
      );
    });
  });

  describe("getUserTokenStatsForced", () => {
    it("should invalidate cache and then get stats", async () => {
      const invalidateSpy = jest
        .spyOn(service, "invalidateUserStatsCache")
        .mockResolvedValue();
      mockRepository.getUserTokenStatsOptimized.mockResolvedValue([
        1,
        1,
        ["dev1"],
      ]);

      await service.getUserTokenStatsForced("user1");
      expect(invalidateSpy).toHaveBeenCalledWith("user1");
      expect(mockRepository.getUserTokenStatsOptimized).toHaveBeenCalled();
    });
  });

  describe("getBatchUserTokenStats", () => {
    it("should return empty map for empty userIds", async () => {
      const result = await service.getBatchUserTokenStats([]);
      expect(result.size).toBe(0);
    });

    it("should process users in batches", async () => {
      mockRepository.getUserTokenStatsOptimized
        .mockResolvedValueOnce([1, 1, ["dev1"]]) // user1
        .mockResolvedValueOnce([2, 2, ["dev1", "dev2"]]) // user2
        .mockResolvedValueOnce([0, 0, []]); // user3

      const userIds = ["user1", "user2", "user3"];
      const result = await service.getBatchUserTokenStats(userIds);

      expect(result.size).toBe(3);
      expect(result.get("user1")).toEqual({
        activeTokens: 1,
        totalTokens: 1,
        deviceCount: 1,
      });
      expect(result.get("user2")).toEqual({
        activeTokens: 2,
        totalTokens: 2,
        deviceCount: 2,
      });
      expect(result.get("user3")).toEqual({
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      });
    });

    it("should handle errors for individual users", async () => {
      mockRepository.getUserTokenStatsOptimized
        .mockResolvedValueOnce([1, 1, ["dev1"]]) // user1
        .mockRejectedValueOnce(new Error("DB error")) // user2
        .mockResolvedValueOnce([0, 0, []]); // user3

      const userIds = ["user1", "user2", "user3"];
      const result = await service.getBatchUserTokenStats(userIds);

      expect(result.size).toBe(3);
      expect(result.get("user1")).toEqual({
        activeTokens: 1,
        totalTokens: 1,
        deviceCount: 1,
      });
      expect(result.get("user2")).toEqual({
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      });
      expect(result.get("user3")).toEqual({
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      });
    });
  });

  describe("invalidateUserStatsCache", () => {
    it("should do nothing for empty userId", async () => {
      await service.invalidateUserStatsCache("");
      expect(mockRepository.deleteKey).not.toHaveBeenCalled();
    });

    it("should delete stats key", async () => {
      await service.invalidateUserStatsCache("user1");
      expect(mockRepository.deleteKey).toHaveBeenCalledWith("stats:user1");
    });

    it("should not throw on error", async () => {
      mockRepository.deleteKey.mockRejectedValue(new Error("DB error"));
      await expect(
        service.invalidateUserStatsCache("user1")
      ).resolves.not.toThrow();
    });
  });

  describe("checkDeviceLimit", () => {
    it("should return true when device limit reached", async () => {
      jest.spyOn(service, "getUserTokenStats").mockResolvedValue({
        activeTokens: 1,
        totalTokens: 1,
        deviceCount: 10, // equal to maxDevicesPerUser
      });

      const result = await service.checkDeviceLimit("user1");
      expect(result).toBe(true);
    });

    it("should return false when device limit not reached", async () => {
      jest.spyOn(service, "getUserTokenStats").mockResolvedValue({
        activeTokens: 1,
        totalTokens: 1,
        deviceCount: 5, // less than maxDevicesPerUser
      });

      const result = await service.checkDeviceLimit("user1");
      expect(result).toBe(false);
    });
  });

  describe("getDeviceCount", () => {
    it("should return device count from stats", async () => {
      jest.spyOn(service, "getUserTokenStats").mockResolvedValue({
        activeTokens: 1,
        totalTokens: 1,
        deviceCount: 3,
      });

      const result = await service.getDeviceCount("user1");
      expect(result).toBe(3);
    });
  });

  describe("getAggregatedStats", () => {
    it("should return empty stats for empty userIds", async () => {
      const result = await service.getAggregatedStats([]);
      expect(result).toEqual({
        totalActiveTokens: 0,
        totalTokens: 0,
        totalDevices: 0,
        averageTokensPerUser: 0,
        averageDevicesPerUser: 0,
      });
    });

    it("should calculate aggregated stats", async () => {
      jest.spyOn(service, "getBatchUserTokenStats").mockResolvedValue(
        new Map([
          ["user1", { activeTokens: 2, totalTokens: 3, deviceCount: 1 }],
          ["user2", { activeTokens: 1, totalTokens: 2, deviceCount: 2 }],
          ["user3", { activeTokens: 0, totalTokens: 1, deviceCount: 0 }],
        ])
      );

      const result = await service.getAggregatedStats([
        "user1",
        "user2",
        "user3",
      ]);
      expect(result).toEqual({
        totalActiveTokens: 3,
        totalTokens: 6,
        totalDevices: 3,
        averageTokensPerUser: 2,
        averageDevicesPerUser: 1,
      });
    });
  });
});
