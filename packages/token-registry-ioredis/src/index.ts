// ===================== IOREDIS ADAPTER =====================

export { IoredisStoreAdapter } from "./ioredis.adapter";
export type { IoredisAdapterOptions } from "./ioredis.adapter";

// ===================== REDIS-SPECIFIC SERVICE WRAPPER =====================

import {
  TokenRegistryService,
  TokenRegistryConfig,
  ITokenValidator,
  ITokenPlugin,
  ITokenMeta,
  TokenData,
  DEFAULT_CONFIG,
} from "@kavabanga/token-registry-core";
import { IoredisStoreAdapter } from "./ioredis.adapter";

/**
 * Redis-specific service wrapper that provides access to Redis adapter methods
 * This extends the base service without modifying the core package
 */
export class RedisTokenRegistryService<
  T extends ITokenMeta = ITokenMeta,
> extends TokenRegistryService<T> {
  private readonly redisAdapter: IoredisStoreAdapter;

  constructor(
    adapter: IoredisStoreAdapter,
    config: TokenRegistryConfig,
    validator: ITokenValidator<T>
  ) {
    super(adapter, config, validator);
    this.redisAdapter = adapter;
  }

  // ===================== REDIS-SPECIFIC METHODS =====================

  /**
   * Gets all tokens for a specific user
   */
  async getUserTokens(
    userId: string
  ): Promise<Array<{ token: string; data: TokenData<T> }>> {
    const tokens = await this.redisAdapter.getUserTokens(userId);
    return tokens.map(({ token, data }) => ({
      token,
      data: data as TokenData<T>,
    }));
  }

  /**
   * Revokes all tokens for a specific user
   */
  async revokeUserTokens(userId: string): Promise<number> {
    return await this.redisAdapter.revokeUserTokens(userId);
  }

  /**
   * Revokes tokens for a specific user and device
   */
  async revokeTokensByDevice(
    userId: string,
    deviceId: string
  ): Promise<number> {
    return await this.redisAdapter.revokeTokensByDevice(userId, deviceId);
  }

  /**
   * Gets all tokens for a specific user and device
   */
  async getUserDeviceTokens(
    userId: string,
    deviceId: string
  ): Promise<Array<{ token: string; data: TokenData<T> }>> {
    const tokens = await this.redisAdapter.getUserDeviceTokens(
      userId,
      deviceId
    );
    return tokens.map(({ token, data }) => ({
      token,
      data: data as TokenData<T>,
    }));
  }

  /**
   * Gets count of active tokens for a user
   */
  async getUserTokenCount(userId: string): Promise<number> {
    return await this.redisAdapter.getUserTokenCount(userId);
  }

  /**
   * Gets basic statistics about stored tokens
   */
  async getTokenStats(): Promise<{
    totalTokens: number;
    userSetsEnabled: boolean;
    keyPrefix: string;
    warning?: string;
  }> {
    return await this.redisAdapter.getTokenStats();
  }

  /**
   * Performs maintenance cleanup of stale user set references
   */
  async cleanupUserSets(): Promise<{
    cleanedSets: number;
    cleanedReferences: number;
    userSetsEnabled: boolean;
  }> {
    return await this.redisAdapter.cleanupUserSets();
  }

  /**
   * Gets information about user sets for monitoring
   */
  async getUserSetsInfo(): Promise<{
    totalUserSets: number;
    userSetsEnabled: boolean;
    avgTokensPerSet?: number;
  }> {
    return await this.redisAdapter.getUserSetsInfo();
  }

  /**
   * Gets the Redis adapter with full type safety
   */
  getRedisAdapter(): IoredisStoreAdapter {
    return this.redisAdapter;
  }
}

/**
 * Factory for creating Redis-specific services
 */
export class RedisTokenRegistryServiceFactory {
  /**
   * Creates new Redis service instance with specified parameters
   */
  static create<T extends ITokenMeta = ITokenMeta>(
    adapter: IoredisStoreAdapter,
    config: TokenRegistryConfig,
    validator: ITokenValidator<T>,
    plugins: ITokenPlugin<T>[] = []
  ): RedisTokenRegistryService<T> {
    const service = new RedisTokenRegistryService(adapter, config, validator);

    // Register all plugins
    plugins.forEach((plugin) => service.registerPlugin(plugin));

    return service;
  }

  /**
   * Creates Redis service with default configuration
   */
  static createDefault<T extends ITokenMeta = ITokenMeta>(
    adapter: IoredisStoreAdapter,
    validator: ITokenValidator<T>
  ): RedisTokenRegistryService<T> {
    return new RedisTokenRegistryService(adapter, DEFAULT_CONFIG, validator);
  }
}
