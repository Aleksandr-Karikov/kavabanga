import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from "@nestjs/common";
import {
  RefreshTokenData,
  RefreshTokenStoreConfiguration,
  TokenAlreadyExistsError,
  TokenOperationFailedError,
  TokenStats,
  TokenStatsOptions,
} from "./refresh-token.types";

import { TokenValidator } from "./validator/token-validator";
import { TokenStatsService } from "./stats/token-stats.service";
import { TokenCleanupService } from "./cleanup/token-cleanup.service";
import { ITokenRepository } from "src/auth/refresh-token/repository/token-repository.interface";
import { TOKEN_REPOSITORY } from "src/auth/refresh-token/refresh-token.symbols";

@Injectable()
export class RefreshTokenStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefreshTokenStore.name);
  private readonly configuration: RefreshTokenStoreConfiguration;

  constructor(
    @Inject("REFRESH_TOKEN_STORE_CONFIG")
    config: Partial<RefreshTokenStoreConfiguration>,
    private readonly validator: TokenValidator,
    @Inject(TOKEN_REPOSITORY)
    private readonly repository: ITokenRepository,
    private readonly statsService: TokenStatsService,
    private readonly cleanupService: TokenCleanupService
  ) {
    this.configuration = this.validator.validateConfig(config);

    this.logger.log(
      `Initialized with TTL: ${this.configuration.ttl}, Used TTL: ${this.configuration.usedTokenTtl} minutes, Scheduled cleanup: ${this.configuration.enableScheduledCleanup ? "enabled" : "disabled"}`
    );
  }

  async onModuleInit() {
    this.logger.log("RefreshTokenStore module initialized");
  }

  async onModuleDestroy() {
    this.logger.log("RefreshTokenStore module destroying...");
  }

  /**
   * Retrieves token data from Redis
   * @param token - The refresh token
   * @returns Token data or null if not found
   * @throws TokenValidationError if data is invalid
   */
  async getTokenData(token: string): Promise<RefreshTokenData | null> {
    if (!token?.trim()) {
      return null;
    }

    const tokenData = await this.repository.getTokenData(token);
    if (!tokenData) {
      return null;
    }

    // Validate retrieved data
    this.validator.validateTokenData(tokenData);
    return tokenData;
  }

  /**
   * Saves a new refresh token
   * @param token - The refresh token to save
   * @param data - Token data (without used/issuedAt fields)
   * @throws TokenAlreadyExistsError if token exists
   * @throws TokenValidationError if data is invalid
   * @throws TokenOperationFailedError if save operation fails
   */
  async save(
    token: string,
    data: Omit<RefreshTokenData, "used" | "issuedAt">
  ): Promise<void> {
    this.validator.validateToken(token, this.configuration.maxTokenLength);
    this.validator.validateCreateTokenData(data);

    // Check device limit
    const hasReachedLimit = await this.statsService.checkDeviceLimit(
      data.userId
    );
    if (hasReachedLimit) {
      throw new TokenOperationFailedError(
        `Device limit reached: ${this.configuration.maxDevicesPerUser}`,
        { userId: data.userId }
      );
    }

    const fullData: RefreshTokenData = {
      ...data,
      issuedAt: Date.now(),
      used: false,
    };

    this.validator.validateTokenData(fullData);

    try {
      const result = await this.repository.saveToken(
        token,
        fullData,
        data.userId
      );

      if (result !== 1) {
        throw new TokenOperationFailedError("Failed to save token", {
          token: token.substring(0, 10) + "...",
          userId: data.userId,
        });
      }

      this.logger.debug("Token saved successfully", {
        userId: data.userId,
        deviceId: data.deviceId,
      });

      await this.statsService.invalidateUserStatsCache(data.userId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw new TokenAlreadyExistsError("Token already exists", {
          token: token.substring(0, 10) + "...",
        });
      }

      this.logger.error("Failed to save token", {
        error: error instanceof Error ? error.message : String(error),
        userId: data.userId,
      });
      throw new TokenOperationFailedError("Failed to save token", {
        token: token.substring(0, 10) + "...",
        error,
      });
    }
  }

  /**
   * Bulk creation of tokens (for testing or migration)
   * @param tokens - Array of tokens to create
   * @returns Number of successfully created tokens
   */
  async saveBatch(
    tokens: Array<{
      token: string;
      data: Omit<RefreshTokenData, "used" | "issuedAt">;
    }>
  ): Promise<number> {
    if (!tokens || tokens.length === 0) {
      return 0;
    }

    const validTokens = this.validator.validateBatchTokens(
      tokens,
      this.configuration.maxBatchSize,
      this.configuration.maxTokenLength
    );

    if (validTokens.length === 0) {
      return 0;
    }

    const userGroups = new Map<
      string,
      Array<{ token: string; data: RefreshTokenData }>
    >();

    // Group tokens by user and prepare full data
    for (const tokenData of validTokens) {
      const fullData: RefreshTokenData = {
        ...tokenData.data,
        issuedAt: Date.now(),
        used: false,
      };

      const userId = tokenData.data.userId;
      if (!userGroups.has(userId)) {
        userGroups.set(userId, []);
      }
      userGroups.get(userId)?.push({
        token: tokenData.token,
        data: fullData,
      });
    }

    let totalSuccessful = 0;

    try {
      for (const [userId, userTokens] of userGroups) {
        const result = await this.repository.saveBatchTokens(
          userTokens,
          userId
        );
        totalSuccessful += result;

        // Invalidate stats cache for users with saved tokens
        if (result > 0) {
          await this.statsService.invalidateUserStatsCache(userId);
        }
      }

      this.logger.log(
        `Batch save completed: ${totalSuccessful}/${tokens.length} tokens saved`
      );

      return totalSuccessful;
    } catch (error) {
      this.logger.error("Batch save failed", {
        error: error instanceof Error ? error.message : String(error),
        tokenCount: tokens.length,
      });
      throw new TokenOperationFailedError("Batch save failed", {
        tokenCount: tokens.length,
        error,
      });
    }
  }

  /**
   * Marks token as used
   * @param token - The refresh token to mark
   * @param userId - User ID for verification
   * @returns true if token was marked, false if not found or already used
   * @throws TokenOperationFailedError if operation fails
   */
  async markUsed(token: string, userId: string): Promise<boolean> {
    if (!token?.trim() || !userId?.trim()) {
      return false;
    }

    try {
      const result = await this.repository.markTokenUsed(token, userId);
      const success = result === 1;

      if (success) {
        this.logger.debug("Token marked as used", { userId });
        await this.statsService.invalidateUserStatsCache(userId);
      }

      return success;
    } catch (error) {
      this.logger.error("Failed to mark token as used", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw new TokenOperationFailedError("Failed to mark token as used", {
        token: token.substring(0, 10) + "...",
        error,
      });
    }
  }

  /**
   * Deletes a refresh token
   * @param token - The refresh token to delete
   * @param userId - User ID for verification
   * @returns true if token was deleted, false if not found
   * @throws TokenOperationFailedError if operation fails
   */
  async delete(token: string, userId: string): Promise<boolean> {
    if (!token?.trim() || !userId?.trim()) {
      return false;
    }

    try {
      const result = await this.repository.deleteToken(token, userId);
      const success = result === 1;

      if (success) {
        this.logger.debug("Token deleted", { userId });
        await this.statsService.invalidateUserStatsCache(userId);
      }

      return success;
    } catch (error) {
      this.logger.error("Failed to delete token", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw new TokenOperationFailedError("Failed to delete token", {
        token: token.substring(0, 10) + "...",
        error,
      });
    }
  }

  /**
   * Revokes all refresh tokens for a user
   * @param userId - User ID whose tokens to revoke
   * @returns Number of tokens revoked
   * @throws TokenOperationFailedError if operation fails
   */
  async revokeAllUserTokens(userId: string): Promise<number> {
    if (!userId?.trim()) {
      return 0;
    }

    try {
      const result = await this.repository.revokeAllTokens(userId);

      this.logger.log("All user tokens revoked", {
        userId,
        revokedCount: result,
      });

      if (result > 0) {
        await this.statsService.invalidateUserStatsCache(userId);
      }

      return result;
    } catch (error) {
      this.logger.error("Failed to revoke all tokens", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw new TokenOperationFailedError("Failed to revoke all tokens", {
        userId,
        error,
      });
    }
  }

  /**
   * Revokes all refresh tokens for a specific device
   * @param userId - User ID whose tokens to revoke
   * @param deviceId - Device ID to revoke tokens for
   * @returns Number of tokens revoked
   * @throws TokenOperationFailedError if operation fails
   */
  async revokeDeviceTokens(userId: string, deviceId: string): Promise<number> {
    if (!userId?.trim() || !deviceId?.trim()) {
      return 0;
    }

    try {
      const result = await this.repository.revokeDeviceTokens(userId, deviceId);

      this.logger.log("Device tokens revoked", {
        userId,
        deviceId,
        revokedCount: result,
      });

      if (result > 0) {
        await this.statsService.invalidateUserStatsCache(userId);
      }

      return result;
    } catch (error) {
      this.logger.error("Failed to revoke device tokens", {
        error: error instanceof Error ? error.message : String(error),
        userId,
        deviceId,
      });
      throw new TokenOperationFailedError("Failed to revoke device tokens", {
        userId,
        deviceId,
        error,
      });
    }
  }

  // ===================== STATS METHODS (DELEGATED) =====================

  /**
   * Retrieves token statistics for a user
   * @param userId - User ID
   * @param options - caching and batching options
   * @returns Token statistics
   */
  async getUserTokenStats(
    userId: string,
    options: TokenStatsOptions = {}
  ): Promise<TokenStats> {
    return this.statsService.getUserTokenStats(userId, options);
  }

  /**
   * Get statistics with forced cache update
   */
  async getUserTokenStatsForced(
    userId: string,
    options: Omit<TokenStatsOptions, "enableCaching"> = {}
  ): Promise<TokenStats> {
    return this.statsService.getUserTokenStatsForced(userId, options);
  }

  /**
   * Batch get statistics for multiple users
   */
  async getBatchUserTokenStats(
    userIds: string[],
    options: TokenStatsOptions = {}
  ): Promise<Map<string, TokenStats>> {
    return this.statsService.getBatchUserTokenStats(userIds, options);
  }

  // ===================== CLEANUP METHODS (DELEGATED) =====================

  /**
   * Performs global cleanup of expired tokens
   */
  async performGlobalCleanup(): Promise<number> {
    return this.cleanupService.performGlobalCleanup();
  }

  // /**
  //  * Cleanup expired tokens for a specific user
  //  */
  // async cleanupUserTokens(userId: string): Promise<number> {
  //   return this.cleanupService.cleanupUserTokens(userId);
  // }

  // ===================== UTILITY METHODS =====================

  /**
   * Check if token exists and is valid
   */
  async exists(token: string): Promise<boolean> {
    if (!token?.trim()) {
      return false;
    }

    try {
      const tokenData = await this.getTokenData(token);
      return tokenData !== null;
    } catch {
      return false;
    }
  }

  /**
   * Check if token is used
   */
  async isUsed(token: string): Promise<boolean> {
    if (!token?.trim()) {
      return false;
    }

    try {
      const tokenData = await this.getTokenData(token);
      return tokenData?.used ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Get configuration (read-only)
   */
  getConfiguration(): Readonly<RefreshTokenStoreConfiguration> {
    return { ...this.configuration };
  }
}
