import { InjectRedis } from "@nestjs-modules/ioredis";
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Redis } from "ioredis";
import * as Joi from "joi";

export class RefreshTokenStoreError extends Error {
  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RefreshTokenStoreError";
  }
}

export class TokenValidationError extends RefreshTokenStoreError {}
export class TokenNotFoundError extends RefreshTokenStoreError {}
export class TokenAlreadyExistsError extends RefreshTokenStoreError {}
export class TokenOperationFailedError extends RefreshTokenStoreError {}
export class ConfigurationError extends RefreshTokenStoreError {}

export interface RefreshTokenData {
  userId: string;
  deviceId: string;
  issuedAt: number;
  used: boolean;
}

export interface TokenStats {
  activeTokens: number;
  totalTokens: number;
  deviceCount: number;
}

export interface TokenStatsOptions {
  enableCaching?: boolean;
  maxBatchSize?: number;
  statsCacheTtl?: number;
}

export interface RefreshTokenStoreConfiguration {
  ttl: number;
  usedTokenTtl: number;
  refreshTokenRedisPrefix: string;
  userTokensSetRedisPrefix: string;
  maxTokenLength: number;
  maxDevicesPerUser: number;
  maxBatchSize: number;
  enableScheduledCleanup: boolean;
}

type LuaCommand<Args extends unknown[], Result> = (
  ...args: Args
) => Promise<Result>;

export interface ExtendedRedis extends Redis {
  saveToken: LuaCommand<[string, string, string, number, string], number>;
  saveBatchTokens: LuaCommand<[string, ...string[]], number>;
  markTokenUsed: LuaCommand<[string, string, string, number], number>;
  deleteToken: LuaCommand<[string, string, string], number>;
  revokeAllTokens: LuaCommand<[string], number>;
  revokeDeviceTokens: LuaCommand<[string, string], number>;
  cleanupExpiredTokens: LuaCommand<[string], number>;
  getUserTokenStatsOptimized: LuaCommand<
    [string, string?, string?, string?],
    [number, number, string[]]
  >;
}

const RefreshTokenDataSchema = Joi.object({
  userId: Joi.string().min(1).max(255).required(),
  deviceId: Joi.string().min(1).max(255).required(),
  issuedAt: Joi.number().integer().positive().required(),
  used: Joi.boolean().required(),
});

const CreateTokenDataSchema = Joi.object({
  userId: Joi.string().min(1).max(255).required(),
  deviceId: Joi.string().min(1).max(255).required(),
});

@Injectable()
export class RefreshTokenStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefreshTokenStore.name);
  private readonly configuration: RefreshTokenStoreConfiguration;
  private readonly DEFAULT_STATS_OPTIONS: Required<TokenStatsOptions> = {
    enableCaching: true,
    maxBatchSize: 100,
    statsCacheTtl: 300,
  };

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject("REFRESH_TOKEN_STORE_CONFIG")
    config: Partial<RefreshTokenStoreConfiguration>
  ) {
    this.configuration = this.validateConfig(config);

    this.logger.log(
      `Initialized with TTL: ${this.configuration.ttl}, Used TTL: ${this.configuration.usedTokenTtl} minutes, Scheduled cleanup: ${this.configuration.enableScheduledCleanup ? "enabled" : "disabled"}`
    );
  }

  validateConfig(
    inputConfig: Partial<RefreshTokenStoreConfiguration>
  ): RefreshTokenStoreConfiguration {
    const MAX_TTL = 365 * 24 * 60 * 60;
    const USED_MAX_TTL = 60 * 60;

    if (inputConfig.ttl < 1 || inputConfig.ttl > MAX_TTL) {
      throw new ConfigurationError(
        `Invalid ttl: must be between 1 and ${MAX_TTL}`,
        { ttl: inputConfig.ttl }
      );
    }

    if (
      inputConfig.usedTokenTtl < 1 ||
      inputConfig.usedTokenTtl > USED_MAX_TTL
    ) {
      throw new ConfigurationError(
        `Invalid usedTokenTtl: must be between 1 and ${USED_MAX_TTL}`,
        { usedTokenTtl: inputConfig.usedTokenTtl }
      );
    }

    const config: RefreshTokenStoreConfiguration = {
      enableScheduledCleanup: inputConfig.enableScheduledCleanup ?? true,
      maxDevicesPerUser: inputConfig.maxDevicesPerUser ?? 10,
      maxTokenLength: inputConfig.maxTokenLength ?? 255,
      refreshTokenRedisPrefix: inputConfig.refreshTokenRedisPrefix ?? "refresh",
      userTokensSetRedisPrefix:
        inputConfig.userTokensSetRedisPrefix ?? "user_tokens",
      ttl: inputConfig.ttl ?? 7 * 24 * 60 * 60,
      usedTokenTtl: inputConfig.usedTokenTtl ?? 5 * 60,
      maxBatchSize: inputConfig.maxBatchSize ?? 300,
    };
    return config;
  }

  async onModuleInit() {
    await this.initializeScripts();

    if (this.configuration.enableScheduledCleanup) {
      this.logger.log(
        "Scheduled cleanup is enabled. Will run every hour at minute 0."
      );
    } else {
      this.logger.log("Scheduled cleanup is disabled.");
    }
  }

  async onModuleDestroy() {
    this.logger.log("RefreshTokenStore module destroying...");
  }

  /**
   * Scheduled cleanup job - runs every hour at minute 0
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: "refresh-token-cleanup",
    timeZone: "UTC",
  })
  async scheduledCleanup(): Promise<void> {
    if (!this.configuration.enableScheduledCleanup) {
      this.logger.debug("Global cleanup is disabled by configuration");
      return;
    }

    this.logger.debug("Starting scheduled token cleanup...");

    try {
      const cleanedCount = await this.performGlobalCleanup();

      if (cleanedCount > 0) {
        this.logger.log(
          `Scheduled cleanup completed: ${cleanedCount} expired tokens removed`
        );
      } else {
        this.logger.debug(
          "Scheduled cleanup completed: no expired tokens found"
        );
      }
    } catch (error) {
      this.logger.error("Scheduled cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async performGlobalCleanup(): Promise<number> {
    let cursor = "0";
    let totalCleaned = 0;
    const BATCH_SIZE = 200;

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${this.configuration.userTokensSetRedisPrefix}:*`,
        "COUNT",
        BATCH_SIZE
      );

      cursor = nextCursor;

      if (keys.length === 0) {
        continue;
      }

      const pipeline = this.redis.pipeline();

      for (const userTokenKey of keys) {
        const userId = userTokenKey.split(":")[1];

        pipeline.eval(
          this.CLEANUP_EXPIRED_SCRIPT,
          1,
          userTokenKey,
          userId,
          this.configuration.refreshTokenRedisPrefix
        );
      }

      const results = await pipeline.exec();

      for (const [error, cleanedCount] of results || []) {
        if (error) {
          this.logger.error(`Cleanup error: ${error.message}`);
          continue;
        }
        totalCleaned += Number(cleanedCount) || 0;
      }

      this.logger.debug(
        `Processed batch: ${keys.length} users, cleaned: ${totalCleaned}`
      );
    } while (cursor !== "0");

    return totalCleaned;
  }

  /**
   * Initializes Lua scripts in Redis and stores their hashes
   */
  private async initializeScripts(): Promise<void> {
    const redis = this.redis as ExtendedRedis;

    redis.defineCommand("saveToken", {
      numberOfKeys: 3,
      lua: this.SAVE_SCRIPT,
    });

    redis.defineCommand("saveBatchTokens", {
      numberOfKeys: 1,
      lua: this.SAVE_BATCH_SCRIPT,
    });

    redis.defineCommand("markTokenUsed", {
      numberOfKeys: 3,
      lua: this.MARK_USED_SCRIPT,
    });

    redis.defineCommand("deleteToken", {
      numberOfKeys: 3,
      lua: this.DELETE_SCRIPT,
    });

    redis.defineCommand("revokeAllTokens", {
      numberOfKeys: 1,
      lua: this.REVOKE_ALL_SCRIPT,
    });

    redis.defineCommand("revokeDeviceTokens", {
      numberOfKeys: 2,
      lua: this.REVOKE_DEVICE_SCRIPT,
    });

    redis.defineCommand("cleanupExpiredTokens", {
      numberOfKeys: 1,
      lua: this.CLEANUP_EXPIRED_SCRIPT,
    });

    redis.defineCommand("getUserTokenStatsOptimized", {
      numberOfKeys: 1,
      lua: this.GET_USER_STATS_SCRIPT,
    });

    this.logger.log("Lua scripts initialized successfully");
  }

  /**
   * Generates Redis key for the token
   * @param token - The refresh token
   * @returns Complete Redis key
   */
  private getKey(token: string): string {
    return `${this.configuration.refreshTokenRedisPrefix}:${token}`;
  }

  /**
   * Generates key for user's token set
   */
  private getUserTokensKey(userId: string): string {
    return `${this.configuration.userTokensSetRedisPrefix}:${userId}`;
  }

  /**
   * Validates token string
   * @param token - Token to validate
   * @throws TokenValidationError if validation fails
   */
  private validateToken(token: string): void {
    if (!token) {
      throw new TokenValidationError("Token is required");
    }

    if (typeof token !== "string") {
      throw new TokenValidationError("Token must be a string");
    }

    if (!token.trim()) {
      throw new TokenValidationError("Token cannot be empty");
    }

    if (token.length > this.configuration.maxTokenLength) {
      throw new TokenValidationError(
        `Token too long: maximum ${this.configuration.maxTokenLength} characters`,
        {
          tokenLength: token.length,
          maxLength: this.configuration.maxTokenLength,
        }
      );
    }
  }

  /**
   * Validates create token data against schema
   * @param data - Token data to validate
   * @throws TokenValidationError if validation fails
   */
  private validateCreateTokenData(
    data: unknown
  ): data is Omit<RefreshTokenData, "used" | "issuedAt"> {
    const { error } = CreateTokenDataSchema.validate(data);
    if (error) {
      throw new TokenValidationError(`Invalid token data: ${error.message}`, {
        validationError: error.details,
        providedData: data,
      });
    }
    return true;
  }

  /**
   * Validates token data against schema
   * @param data - Token data to validate
   * @throws TokenValidationError if validation fails
   */
  private validateTokenData(data: unknown): data is RefreshTokenData {
    const { error } = RefreshTokenDataSchema.validate(data);
    if (error) {
      throw new TokenValidationError(`Invalid token data: ${error.message}`, {
        validationError: error.details,
      });
    }
    return true;
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

    const key = this.getKey(token);
    const raw = await this.redis.get(key);
    if (!raw) return null;

    try {
      const parsedData = JSON.parse(raw);
      this.validateTokenData(parsedData);
      return parsedData;
    } catch (error) {
      this.logger.error("Invalid token data format", {
        token: token.substring(0, 10) + "...",
        error: error instanceof Error ? error.message : String(error),
        raw: raw.substring(0, 100) + "...",
      });
      throw new TokenValidationError("Invalid token data format", {
        token: token.substring(0, 10) + "...",
        error,
      });
    }
  }

  private get redisTyped(): ExtendedRedis {
    return this.redis as ExtendedRedis;
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
    this.validateToken(token);
    this.validateCreateTokenData(data);

    const stats = await this.getUserTokenStats(data.userId);

    if (stats.deviceCount >= this.configuration.maxDevicesPerUser) {
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

    this.validateTokenData(fullData);
    const key = this.getKey(token);
    const userTokensKey = this.getUserTokensKey(data.userId);

    try {
      const result = await this.redisTyped.saveToken(
        key,
        data.userId,
        userTokensKey,
        this.configuration.ttl,
        JSON.stringify(fullData)
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
      await this.invalidateUserStatsCache(data.userId);
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
    if (tokens.length > this.configuration.maxBatchSize) {
      throw new Error(
        `Batch size exceeded limit: ${this.configuration.maxBatchSize}`
      );
    }

    const userGroups = new Map<string, typeof tokens>();

    for (const tokenData of tokens) {
      try {
        this.validateToken(tokenData.token);
        this.validateCreateTokenData(tokenData.data);

        const userId = tokenData.data.userId;
        if (!userGroups.has(userId)) {
          userGroups.set(userId, []);
        }
        userGroups.get(userId)?.push(tokenData);
      } catch (error) {
        this.logger.warn("Skipping invalid token in batch", {
          token: tokenData.token.substring(0, 10) + "...",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let totalSuccessful = 0;

    try {
      for (const [userId, userTokens] of userGroups) {
        const userTokensKey = this.getUserTokensKey(userId);
        const args: string[] = [userTokensKey];

        for (const { token, data } of userTokens) {
          const fullData: RefreshTokenData = {
            ...data,
            issuedAt: Date.now(),
            used: false,
          };

          const key = this.getKey(token);
          args.push(
            key,
            JSON.stringify(fullData),
            this.configuration.ttl.toString()
          );
        }

        const result = await this.redisTyped.saveBatchTokens(
          userTokensKey,
          ...args
        );
        totalSuccessful += result;
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

    const key = this.getKey(token);
    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.redisTyped.markTokenUsed(
        key,
        userId,
        userTokensKey,
        this.configuration.usedTokenTtl
      );

      const success = result === 1;
      if (success) {
        this.logger.debug("Token marked as used", { userId });
      }
      if (success) {
        await this.invalidateUserStatsCache(userId);
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

    const key = this.getKey(token);
    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.redisTyped.deleteToken(
        key,
        userId,
        userTokensKey
      );

      const success = result === 1;
      if (success) {
        this.logger.debug("Token deleted", { userId });
      }
      if (success) {
        await this.invalidateUserStatsCache(userId);
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

    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.redisTyped.revokeAllTokens(userTokensKey);

      this.logger.log("All user tokens revoked", {
        userId,
        revokedCount: result,
      });

      if (result > 0) {
        await this.invalidateUserStatsCache(userId);
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

    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.redisTyped.revokeDeviceTokens(
        userTokensKey,
        deviceId
      );

      this.logger.log("Device tokens revoked", {
        userId,
        deviceId,
        revokedCount: result,
      });
      if (result > 0) {
        await this.invalidateUserStatsCache(userId);
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

  /**
   * invalidate user's cache
   * @param userId - user id
   */
  async invalidateUserStatsCache(userId: string): Promise<void> {
    if (!userId?.trim()) return;

    try {
      const statsKey = `${this.configuration.userTokensSetRedisPrefix}:stats:${userId}`;
      await this.redis.del(statsKey);

      this.logger.debug("User stats cache invalidated", { userId });
    } catch (error) {
      this.logger.warn("Failed to invalidate user stats cache", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * get statistic with forced update cache
   * @param userId - user ID
   * @param options - batching options
   */
  async getUserTokenStatsForced(
    userId: string,
    options: Omit<TokenStatsOptions, "enableCaching"> = {}
  ): Promise<TokenStats> {
    await this.invalidateUserStatsCache(userId);
    return this.getUserTokenStats(userId, { ...options, enableCaching: true });
  }

  /**
   * batch get statistic for some users
   * @param userIds - user ids
   * @param options - options to cache and batch
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
   * Retrieves token statistics for a user
   * @param userId - User ID
   * @param options - caching and batching options
   * @returns Token statistics
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
      const userTokensKey = this.getUserTokensKey(userId);
      const statsKey = opts.enableCaching
        ? `${this.configuration.userTokensSetRedisPrefix}:stats:${userId}`
        : "";

      const [activeTokens, totalTokens, deviceIds] =
        await this.redisTyped.getUserTokenStatsOptimized(
          userTokensKey,
          opts.maxBatchSize.toString(),
          statsKey,
          opts.statsCacheTtl.toString()
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
  // ===================== LUA SCRIPTS =====================

  /**
   * Lua script to save a new token
   * Verifies token doesn't exist, sets it with TTL, and adds to user's token set
   */
  private readonly SAVE_SCRIPT = `
    local key = KEYS[1]
    local userId = KEYS[2]
    local userTokensKey = KEYS[3]
    local ttl = ARGV[1]
    local data = ARGV[2]

    -- Verify userId in data matches using pcall for safety
    local ok, parsedData = pcall(cjson.decode, data)
    if not ok then
      return redis.error_reply("Invalid JSON data")
    end

    if type(parsedData.userId) ~= "string" or parsedData.userId ~= userId then
      return redis.error_reply("User ID mismatch")
    end
    
    -- Use SET with NX for atomicity
    local result = redis.call('SET', key, data, 'EX', ttl, 'NX')
    if not result then
      return redis.error_reply("Token already exists")
    end
    
    -- Add to user's set
    redis.call('SADD', userTokensKey, key)
    return 1
  `;

  /**
   * Improved atomic batch save Lua script
   */
  private readonly SAVE_BATCH_SCRIPT = `
    local userTokensKey = KEYS[1]
    local saved = 0
    
    -- Process tokens in groups of 3 (key, data, ttl)
    for i = 2, #ARGV, 3 do
      local key = ARGV[i]
      local data = ARGV[i + 1]
      local ttl = ARGV[i + 2]
      
      if key and data and ttl then
        local result = redis.call('SET', key, data, 'EX', ttl, 'NX')
        if result then
          redis.call('SADD', userTokensKey, key)
          saved = saved + 1
        end
      end
    end
    
    return saved
  `;

  /**
   * Lua script to mark token as used
   * Verifies token exists, belongs to user, and isn't already used
   * Updates token, sets shorter TTL, and removes from user's active tokens
   */
  private readonly MARK_USED_SCRIPT = `
    local key = KEYS[1]
    local userId = KEYS[2]
    local userTokensKey = KEYS[3]
    local usedTtl = ARGV[1]

    local data = redis.call('GET', key)
    if not data then return 0 end

    local ok, parsed = pcall(cjson.decode, data)
    if not ok then return 0 end
    
    if parsed.used then return 0 end
    if parsed.userId ~= userId then return 0 end

    parsed.used = true
    redis.call('SET', key, cjson.encode(parsed), 'EX', usedTtl)
    redis.call('SREM', userTokensKey, key)
    return 1
  `;

  /**
   * Lua script to delete token
   * Verifies token exists and belongs to user before deletion
   */
  private readonly DELETE_SCRIPT = `
    local key = KEYS[1]
    local userId = KEYS[2]
    local userTokensKey = KEYS[3]

    local data = redis.call('GET', key)
    if not data then return 0 end

    local ok, parsed = pcall(cjson.decode, data)
    if not ok then return 0 end
    
    if parsed.userId ~= userId then return 0 end

    redis.call('DEL', key)
    redis.call('SREM', userTokensKey, key)
    return 1
  `;

  /**
   * Lua script to revoke all user tokens
   * Deletes all tokens in user's set and the set itself
   */
  private readonly REVOKE_ALL_SCRIPT = `
    local userTokensKey = KEYS[1]
    local tokens = redis.call('SMEMBERS', userTokensKey)

    for _, key in ipairs(tokens) do
      redis.call('DEL', key)
    end
    redis.call('DEL', userTokensKey)
    return #tokens
  `;

  /**
   * Lua script to revoke tokens for specific device
   * Finds all tokens for device, deletes them and removes from user's set
   */
  private readonly REVOKE_DEVICE_SCRIPT = `
    local userTokensKey = KEYS[1]
    local deviceId = KEYS[2]
    local tokens = redis.call('SMEMBERS', userTokensKey)
    local removed = 0

    for _, key in ipairs(tokens) do
      local data = redis.call('GET', key)
      if data then
        local ok, parsed = pcall(cjson.decode, data)
        if ok and parsed.deviceId == deviceId then
          redis.call('DEL', key)
          redis.call('SREM', userTokensKey, key)
          removed = removed + 1
        end
      else
        -- Remove orphaned key from set
        redis.call('SREM', userTokensKey, key)
      end
    end
    return removed
  `;

  private readonly CLEANUP_EXPIRED_SCRIPT = `
    local userTokensKey = KEYS[1]
    local tokens = redis.call('SMEMBERS', userTokensKey)
    local cleaned = 0

    for _, key in ipairs(tokens) do
      local ttl = redis.call('TTL', key)
      if ttl == -2 then  -- Key doesn't exist
        redis.call('SREM', userTokensKey, key)
        cleaned = cleaned + 1
      elseif ttl == -1 then  -- Key exists but has no TTL (shouldn't happen)
        redis.call('DEL', key)
        redis.call('SREM', userTokensKey, key)
        cleaned = cleaned + 1
      end
    end
    return cleaned
  `;

  private readonly GET_USER_STATS_SCRIPT = `
    local userTokensKey = KEYS[1]
    local maxBatchSize = tonumber(ARGV[1]) or 100
    local statsKey = ARGV[2]
    local statsTtl = tonumber(ARGV[3]) or 300

    -- Проверяем кэшированную статистику если включена
    if statsKey and statsKey ~= "" then
      local cachedStats = redis.call('HMGET', statsKey, 'active', 'total', 'devices', 'lastUpdated')
      if cachedStats[1] and cachedStats[2] and cachedStats[3] then
        local lastUpdated = tonumber(cachedStats[4]) or 0
        local currentTime = redis.call('TIME')[1]
        
        -- Если кэш не старше TTL, возвращаем кэшированные данные
        if (currentTime - lastUpdated) < statsTtl then
          local devices = {}
          if cachedStats[3] and cachedStats[3] ~= "" then
            -- Парсим устройства из строки (разделенные запятыми)
            for device in string.gmatch(cachedStats[3], "([^,]+)") do
              table.insert(devices, device)
            end
          end
          return {tonumber(cachedStats[1]) or 0, tonumber(cachedStats[2]) or 0, devices}
        end
      end
    end

    -- Получаем все токены пользователя
    local tokens = redis.call('SMEMBERS', userTokensKey)
    local tokenCount = #tokens

    -- Если токенов нет, возвращаем нули
    if tokenCount == 0 then
      -- Кэшируем пустую статистику
      if statsKey and statsKey ~= "" then
        local currentTime = redis.call('TIME')[1]
        redis.call('HMSET', statsKey, 
          'active', '0', 
          'total', '0', 
          'devices', '', 
          'lastUpdated', currentTime
        )
        redis.call('EXPIRE', statsKey, statsTtl)
      end
      return {0, 0, {}}
    end

    local activeTokens = 0
    local totalTokens = 0
    local deviceSet = {} -- Используем как Set для уникальных deviceId
    local orphanedKeys = {}
    local processedTokens = 0

    -- Функция для обработки батча токенов
    local function processBatch(tokenBatch)
      if #tokenBatch == 0 then return end
      
      -- Используем MGET для получения всех данных токенов в батче
      local dataArray = redis.call('MGET', unpack(tokenBatch))
      
      for i, data in ipairs(dataArray) do
        local tokenKey = tokenBatch[i]
        
        if data then
          -- Пытаемся распарсить JSON с защитой от ошибок
          local ok, parsed = pcall(cjson.decode, data)
          
          if ok and type(parsed) == "table" and parsed.userId and parsed.deviceId then
            totalTokens = totalTokens + 1
            
            -- Проверяем, не использован ли токен
            if not parsed.used then
              activeTokens = activeTokens + 1
            end
            
            -- Добавляем устройство в Set (используем deviceId как ключ)
            deviceSet[parsed.deviceId] = true
          else
            -- Помечаем как orphaned если данные невалидны
            table.insert(orphanedKeys, tokenKey)
          end
        else
          -- Помечаем как orphaned если данных нет
          table.insert(orphanedKeys, tokenKey)
        end
      end
    end

    -- Обрабатываем токены батчами для предотвращения длительной блокировки
    if tokenCount <= maxBatchSize then
      -- Если токенов немного, обрабатываем все сразу
      processBatch(tokens)
    else
      -- Разбиваем на батчи
      local batchCount = math.ceil(tokenCount / maxBatchSize)
      
      for batchIndex = 1, batchCount do
        local startIdx = (batchIndex - 1) * maxBatchSize + 1
        local endIdx = math.min(batchIndex * maxBatchSize, tokenCount)
        
        local batch = {}
        for i = startIdx, endIdx do
          table.insert(batch, tokens[i])
        end
        
        processBatch(batch)
        processedTokens = processedTokens + #batch
        
        -- Проверяем лимит обработки для предотвращения слишком долгой блокировки
        -- Если обрабатываем больше 500 токенов, возвращаем приблизительную статистику
        if processedTokens >= 500 then
          -- Экстраполируем результаты на основе обработанной части
          local processed_ratio = processedTokens / tokenCount
          activeTokens = math.floor(activeTokens / processed_ratio)
          totalTokens = math.floor(totalTokens / processed_ratio)
          break
        end
      end
    end

    -- Очищаем orphaned ключи из множества (пакетно для эффективности)
    if #orphanedKeys > 0 then
      -- Ограничиваем количество удалений за один раз
      local maxCleanup = math.min(#orphanedKeys, 50)
      for i = 1, maxCleanup do
        redis.call('SREM', userTokensKey, orphanedKeys[i])
      end
    end

    -- Преобразуем deviceSet в массив
    local devices = {}
    for deviceId, _ in pairs(deviceSet) do
      table.insert(devices, deviceId)
    end

    -- Кэшируем результаты если включено кэширование
    if statsKey and statsKey ~= "" and processedTokens < 500 then
      local currentTime = redis.call('TIME')[1]
      local devicesString = table.concat(devices, ",")
      
      redis.call('HMSET', statsKey, 
        'active', tostring(activeTokens), 
        'total', tostring(totalTokens), 
        'devices', devicesString,
        'lastUpdated', currentTime
      )
      redis.call('EXPIRE', statsKey, statsTtl)
    end

    -- Возвращаем статистику
    return {activeTokens, totalTokens, devices}
    `;
}
