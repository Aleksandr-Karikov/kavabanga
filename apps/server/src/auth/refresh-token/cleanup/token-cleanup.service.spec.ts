import { RedisTokenRepository } from "../repository/redis-token-repository";
import { Test, TestingModule } from "@nestjs/testing";
import { RefreshTokenStoreConfiguration } from "../refresh-token.types";
import { TokenCleanupService } from "./token-cleanup.service";

describe("TokenCleanupService", () => {
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

  let mockRepository: jest.Mocked<RedisTokenRepository>;
  let service: TokenCleanupService;

  beforeEach(async () => {
    mockRepository = {
      scanUserTokenKeys: jest.fn(),
      cleanupUserExpiredTokens: jest.fn(),
    } as unknown as jest.Mocked<RedisTokenRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: TokenCleanupService,
          useFactory: (repo: RedisTokenRepository) =>
            new TokenCleanupService(repo, mockConfig),
          inject: [RedisTokenRepository],
        },
        {
          provide: RedisTokenRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get(TokenCleanupService);
  });

  describe("performGlobalCleanup", () => {
    it("should clean up expired tokens for multiple users", async () => {
      mockRepository.scanUserTokenKeys
        .mockResolvedValueOnce(["1", ["user_tokens:123", "user_tokens:456"]])
        .mockResolvedValueOnce(["0", []]);

      mockRepository.cleanupUserExpiredTokens
        .mockResolvedValueOnce(2) // for user 123
        .mockResolvedValueOnce(3); // for user 456

      const result = await service.performGlobalCleanup();

      expect(result).toBe(5);
      expect(mockRepository.scanUserTokenKeys).toHaveBeenCalledTimes(2);
      expect(mockRepository.cleanupUserExpiredTokens).toHaveBeenCalledWith(
        "123"
      );
      expect(mockRepository.cleanupUserExpiredTokens).toHaveBeenCalledWith(
        "456"
      );
    });

    it("should return 0 when no user tokens are found", async () => {
      mockRepository.scanUserTokenKeys.mockResolvedValueOnce(["0", []]);

      const result = await service.performGlobalCleanup();

      expect(result).toBe(0);
      expect(mockRepository.cleanupUserExpiredTokens).not.toHaveBeenCalled();
    });

    it("should handle errors during individual user cleanup and continue", async () => {
      mockRepository.scanUserTokenKeys.mockResolvedValueOnce([
        "0",
        ["user_tokens:1", "user_tokens:2"],
      ]);

      mockRepository.cleanupUserExpiredTokens
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error("Redis error"));

      const result = await service.performGlobalCleanup();

      expect(result).toBe(1);
      expect(mockRepository.cleanupUserExpiredTokens).toHaveBeenCalledWith("1");
      expect(mockRepository.cleanupUserExpiredTokens).toHaveBeenCalledWith("2");
    });
  });
});
