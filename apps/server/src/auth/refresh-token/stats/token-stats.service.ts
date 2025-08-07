import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  TokenStats,
  TokenStatsOptions,
  TokenOperationFailedError,
  RefreshTokenStoreConfiguration,
} from "../refresh-token.types";
import { ITokenRepository } from "src/auth/refresh-token/repository/token-repository.interface";
import { TOKEN_REPOSITORY } from "src/auth/refresh-token/refresh-token.symbols";

@Injectable()
export class TokenStatsService {
  private readonly logger = new Logger(TokenStatsService.name);
  private readonly DEFAULT_STATS_OPTIONS: Required<TokenStatsOptions> = {
    enableCaching: true,
    maxBatchSize: 100,
    statsCacheTtl: 300,
  };

  constructor(
    @Inject(TOKEN_REPOSITORY)
    private readonly repository: ITokenRepository,
    private readonly configuration: RefreshTokenStoreConfiguration
  ) {}

  /**
   * Retrieves token statistics for a user
   */
  async getUserTokenStats(
    userId: string,
    options: TokenStatsOptions = {}
  ): Promise<TokenStats> {
    if (!userId?.trim()) {
      return {
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      };
    }

    const opts = { ...this.DEFAULT_STATS_OPTIONS, ...options };

    try {
      const [activeTokens, totalTokens, deviceIds] =
        await this.repository.getUserTokenStatsOptimized(
          userId,
          opts.maxBatchSize,
          opts.statsCacheTtl
        );

      const stats: TokenStats = {
        activeTokens,
        totalTokens,
        deviceCount: deviceIds.length,
      };

      if (totalTokens > 200) {
        this.logger.warn("User has excessive number of tokens", {
          userId,
          totalTokens,
          activeTokens,
          deviceCount: deviceIds.length,
        });
      }

      return stats;
    } catch (error) {
      this.logger.error("Failed to get user token stats", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        options: opts,
      });
      throw new TokenOperationFailedError("Failed to get user token stats", {
        userId,
        error,
      });
    }
  }

  /**
   * Get statistics with forced cache update
   */
  async getUserTokenStatsForced(
    userId: string,
    options: Omit<TokenStatsOptions, "enableCaching"> = {}
  ): Promise<TokenStats> {
    await this.invalidateUserStatsCache(userId);
    return this.getUserTokenStats(userId, { ...options, enableCaching: true });
  }

  /**
   * Batch get statistics for multiple users
   */
  async getBatchUserTokenStats(
    userIds: string[],
    options: TokenStatsOptions = {}
  ): Promise<Map<string, TokenStats>> {
    const results = new Map<string, TokenStats>();

    if (!userIds.length) return results;

    const opts = { ...this.DEFAULT_STATS_OPTIONS, ...options };
    const CONCURRENT_LIMIT = 10;

    for (let i = 0; i < userIds.length; i += CONCURRENT_LIMIT) {
      const batch = userIds.slice(i, i + CONCURRENT_LIMIT);

      const promises = batch.map(async (userId) => {
        try {
          const stats = await this.getUserTokenStats(userId, opts);
          return { userId, stats };
        } catch (error) {
          this.logger.warn("Failed to get stats for user in batch", {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            userId,
            stats: { activeTokens: 0, totalTokens: 0, deviceCount: 0 },
          };
        }
      });

      const batchResults = await Promise.all(promises);

      for (const { userId, stats } of batchResults) {
        results.set(userId, stats);
      }
    }

    return results;
  }

  /**
   * Invalidate user's stats cache
   */
  async invalidateUserStatsCache(userId: string): Promise<void> {
    if (!userId?.trim()) return;

    try {
      await this.repository.invalidateStatsCache(userId);

      this.logger.debug("User stats cache invalidated", { userId });
    } catch (error) {
      this.logger.warn("Failed to invalidate user stats cache", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if user has reached device limit
   */
  async checkDeviceLimit(userId: string): Promise<boolean> {
    const stats = await this.getUserTokenStats(userId);
    return stats.deviceCount >= this.configuration.maxDevicesPerUser;
  }

  /**
   * Get current device count for user
   */
  async getDeviceCount(userId: string): Promise<number> {
    const stats = await this.getUserTokenStats(userId);
    return stats.deviceCount;
  }

  /**
   * Get aggregated stats for multiple users
   */
  async getAggregatedStats(userIds: string[]): Promise<{
    totalActiveTokens: number;
    totalTokens: number;
    totalDevices: number;
    averageTokensPerUser: number;
    averageDevicesPerUser: number;
  }> {
    if (!userIds.length) {
      return {
        totalActiveTokens: 0,
        totalTokens: 0,
        totalDevices: 0,
        averageTokensPerUser: 0,
        averageDevicesPerUser: 0,
      };
    }

    const statsMap = await this.getBatchUserTokenStats(userIds);

    let totalActiveTokens = 0;
    let totalTokens = 0;
    let totalDevices = 0;

    for (const stats of statsMap.values()) {
      totalActiveTokens += stats.activeTokens;
      totalTokens += stats.totalTokens;
      totalDevices += stats.deviceCount;
    }

    const userCount = userIds.length;

    return {
      totalActiveTokens,
      totalTokens,
      totalDevices,
      averageTokensPerUser: userCount > 0 ? totalTokens / userCount : 0,
      averageDevicesPerUser: userCount > 0 ? totalDevices / userCount : 0,
    };
  }
}
