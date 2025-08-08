import { Injectable } from "@nestjs/common";
import { ITokenRepository } from "./token-repository.interface";
import { RedisTokenRepository } from "./redis-token-repository";
import { RefreshTokenData } from "src/auth/refresh-token/refresh-token.types";
import { CircuitBreakerManager } from "src/common/circuit-breaker.manager";

@Injectable()
export class ResilientTokenRepository implements ITokenRepository {
  private readonly defaultOptions = {
    timeout: 5000, // 5 seconds default timeout
    errorThresholdPercentage: 50, // Open circuit after 50% failures
    resetTimeout: 30000, // 30 seconds reset timeout
  };

  constructor(
    private readonly repository: RedisTokenRepository,
    private readonly circuitBreakerManager: CircuitBreakerManager
  ) {}

  async invalidateStatsCache(userId: string): Promise<number> {
    return this.circuitBreakerManager.fire(
      "invalidateStatsCache",
      () => this.repository.invalidateStatsCache(userId),
      [userId],
      this.defaultOptions
    );
  }

  async getTokenData(token: string): Promise<RefreshTokenData | null> {
    return this.circuitBreakerManager.fire(
      "getTokenData",
      () => this.repository.getTokenData(token),
      [],
      this.defaultOptions
    );
  }

  async saveToken(
    token: string,
    data: RefreshTokenData,
    userId: string
  ): Promise<number> {
    return this.circuitBreakerManager.fire(
      "saveToken",
      () => this.repository.saveToken(token, data, userId),
      [],
      this.defaultOptions
    );
  }

  async saveBatchTokens(
    userTokens: Array<{ token: string; data: RefreshTokenData }>,
    userId: string
  ): Promise<number> {
    return this.circuitBreakerManager.fire(
      "saveBatchTokens",
      () => this.repository.saveBatchTokens(userTokens, userId),
      [],
      { ...this.defaultOptions, timeout: 10000 } // Longer timeout for batch operations
    );
  }

  async markTokenUsed(token: string, userId: string): Promise<number> {
    return this.circuitBreakerManager.fire(
      "markTokenUsed",
      () => this.repository.markTokenUsed(token, userId),
      [],
      this.defaultOptions
    );
  }

  async deleteToken(token: string, userId: string): Promise<number> {
    return this.circuitBreakerManager.fire(
      "deleteToken",
      () => this.repository.deleteToken(token, userId),
      [],
      this.defaultOptions
    );
  }

  async revokeAllTokens(userId: string): Promise<number> {
    return this.circuitBreakerManager.fire(
      "revokeAllTokens",
      () => this.repository.revokeAllTokens(userId),
      [],
      this.defaultOptions
    );
  }

  async revokeDeviceTokens(userId: string, deviceId: string): Promise<number> {
    return this.circuitBreakerManager.fire(
      "revokeDeviceTokens",
      () => this.repository.revokeDeviceTokens(userId, deviceId),
      [],
      this.defaultOptions
    );
  }

  async getUserTokenStatsOptimized(
    userId: string,
    maxBatchSize: number,
    statsCacheTtl: number
  ): Promise<[number, number, string[]]> {
    return this.circuitBreakerManager.fire(
      "getUserTokenStatsOptimized",
      () =>
        this.repository.getUserTokenStatsOptimized(
          userId,
          maxBatchSize,
          statsCacheTtl
        ),
      [],
      { ...this.defaultOptions, timeout: 8000 } // Longer timeout for stats operation
    );
  }

  async cleanupUserExpiredTokens(userId: string): Promise<number> {
    return this.circuitBreakerManager.fire(
      "cleanupExpiredTokens",
      () => this.repository.cleanupUserExpiredTokens(userId),
      [],
      this.defaultOptions
    );
  }

  async scanUserTokenKeys(
    cursor: string = "0",
    batchSize: number = 200
  ): Promise<[string, string[]]> {
    return this.circuitBreakerManager.fire(
      "scanUserTokenKeys",
      () => this.repository.scanUserTokenKeys(cursor, batchSize),
      [],
      this.defaultOptions
    );
  }

  async deleteKey(key: string): Promise<number> {
    return this.circuitBreakerManager.fire(
      "deleteKey",
      () => this.repository.deleteKey(key),
      [],
      this.defaultOptions
    );
  }

  async healthCheck(): Promise<boolean> {
    return this.circuitBreakerManager.fire(
      "healthCheck",
      () => this.repository.healthCheck(),
      [],
      { ...this.defaultOptions, timeout: 2000 } // Shorter timeout for health check
    );
  }

  createPipeline() {
    // Pipeline doesn't need circuit breaker as it's just a builder
    return this.repository.createPipeline();
  }
}
