import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
  cleanupOrphanedTokens: LuaCommand<[string], number>;
  cleanupExpiredTokens: LuaCommand<[string], number>;
  getUserTokenStatsOptimized: LuaCommand<[string], [number, number, string[]]>;
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
  private readonly ttlSeconds: number;
  private readonly usedTokenTtlSeconds: number;
  private readonly refreshTokenRedisPrefix = "refresh";
  private readonly userTokensPrefix: string;
  private readonly maxTokenLength: number;
  private readonly enableScheduledCleanup: boolean;

  constructor(
    private readonly redis: Redis,
    configService: ConfigService
  ) {
    const refreshTokenTtlDays = configService.get<number>(
      "REFRESH_TOKEN_TTL_DAYS",
      7
    );
    if (refreshTokenTtlDays < 1 || refreshTokenTtlDays > 365) {
      throw new ConfigurationError(
        "Invalid REFRESH_TOKEN_TTL_DAYS: must be between 1 and 365",
        { refreshTokenTtlDays }
      );
    }

    const usedTokenTtlMinutes = configService.get<number>(
      "USED_TOKEN_TTL_MINUTES",
      5
    );
    if (usedTokenTtlMinutes < 1 || usedTokenTtlMinutes > 60) {
      throw new ConfigurationError(
        "Invalid USED_TOKEN_TTL_MINUTES: must be between 1 and 60",
        { usedTokenTtlMinutes }
      );
    }

    this.userTokensPrefix = configService.get<string>(
      "REDIS_USER_TOKENS_PREFIX",
      "user_tokens"
    );

    this.maxTokenLength = configService.get<number>("MAX_TOKEN_LENGTH", 1000);

    this.enableScheduledCleanup = configService.get<boolean>(
      "ENABLE_TOKEN_CLEANUP",
      true
    );

    this.ttlSeconds = 60 * 60 * 24 * refreshTokenTtlDays;
    this.usedTokenTtlSeconds = 60 * usedTokenTtlMinutes;

    this.logger.log(
      `Initialized with TTL: ${refreshTokenTtlDays} days, Used TTL: ${usedTokenTtlMinutes} minutes, Scheduled cleanup: ${this.enableScheduledCleanup ? "enabled" : "disabled"}`
    );
  }

  async onModuleInit() {
    await this.initializeScripts();

    if (this.enableScheduledCleanup) {
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
    if (!this.enableScheduledCleanup) {
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
    try {
      const pattern = `${this.userTokensPrefix}:*`;
      const userTokenKeys = await this.redis.keys(pattern);

      let totalCleaned = 0;

      const pipeline = this.redis.pipeline();

      for (const userTokenKey of userTokenKeys) {
        pipeline.eval(this.CLEANUP_EXPIRED_SCRIPT, 1, userTokenKey);
      }

      const results = await pipeline.exec();

      if (results) {
        for (const [err, result] of results) {
          if (!err && typeof result === "number") {
            totalCleaned += result;
          }
        }
      }

      return totalCleaned;
    } catch (error) {
      this.logger.error("Global cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new TokenOperationFailedError("Global cleanup failed", { error });
    }
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

    redis.defineCommand("cleanupOrphanedTokens", {
      numberOfKeys: 1,
      lua: this.CLEANUP_ORPHANED_SCRIPT,
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
    return `${this.refreshTokenRedisPrefix}:${token}`;
  }

  /**
   * Generates key for user's token set
   */
  private getUserTokensKey(userId: string): string {
    return `${this.userTokensPrefix}:${userId}`;
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

    if (token.length > this.maxTokenLength) {
      throw new TokenValidationError(
        `Token too long: maximum ${this.maxTokenLength} characters`,
        { tokenLength: token.length, maxLength: this.maxTokenLength }
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
        this.ttlSeconds,
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
          args.push(key, JSON.stringify(fullData), this.ttlSeconds.toString());
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
        this.usedTokenTtlSeconds
      );

      const success = result === 1;
      if (success) {
        this.logger.debug("Token marked as used", { userId });
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
   * Очищает orphaned записи в user tokens sets
   * @param userId - User ID для очистки
   * @returns Количество очищенных записей
   */
  async cleanupOrphanedTokens(userId: string): Promise<number> {
    if (!userId?.trim()) {
      return 0;
    }

    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.redisTyped.cleanupOrphanedTokens(userTokensKey);

      if (result > 0) {
        this.logger.log("Orphaned tokens cleaned up", {
          userId,
          cleanedCount: result,
        });
      }

      return result;
    } catch (error) {
      this.logger.error("Failed to cleanup orphaned tokens", {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw new TokenOperationFailedError("Failed to cleanup orphaned tokens", {
        userId,
        error,
      });
    }
  }

  /**
   * Retrieves token statistics for a user
   * @param userId - User ID
   * @returns Token statistics
   */
  async getUserTokenStats(userId: string): Promise<TokenStats> {
    if (!userId?.trim()) {
      return {
        activeTokens: 0,
        totalTokens: 0,
        deviceCount: 0,
      };
    }

    try {
      const userTokensKey = this.getUserTokensKey(userId);
      const [activeTokens, totalTokens, deviceIds] =
        await this.redisTyped.getUserTokenStatsOptimized(userTokensKey);

      return {
        activeTokens,
        totalTokens,
        deviceCount: deviceIds.length,
      };
    } catch (error) {
      this.logger.error("Failed to get user token stats", {
        error: error instanceof Error ? error.message : String(error),
        userId,
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
    
    if parsedData.userId ~= userId then
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

  /**
   * Lua script для очистки orphaned токенов
   */
  private readonly CLEANUP_ORPHANED_SCRIPT = `
    local userTokensKey = KEYS[1]
    local tokens = redis.call('SMEMBERS', userTokensKey)
    local cleaned = 0

    for _, key in ipairs(tokens) do
      if redis.call('EXISTS', key) == 0 then
        redis.call('SREM', userTokensKey, key)
        cleaned = cleaned + 1
      end
    end
    return cleaned
  `;

  /**
   * NEW: Lua script для очистки истекших токенов
   */
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
    local tokens = redis.call('SMEMBERS', userTokensKey)
    local activeTokens = 0
    local totalTokens = 0
    local deviceSet = {}
    local orphanedKeys = {}
  
    for _, key in ipairs(tokens) do
      local data = redis.call('GET', key)
      if data then
        local ok, parsed = pcall(cjson.decode, data)
        if ok and parsed.userId and parsed.deviceId then
          totalTokens = totalTokens + 1
          if not parsed.used then
            activeTokens = activeTokens + 1
          end
          if not deviceSet[parsed.deviceId] then
            deviceSet[parsed.deviceId] = true
          end
        else
          -- Поврежденные данные - помечаем ключ для удаления
          table.insert(orphanedKeys, key)
        end
      else
        -- Несуществующий токен - помечаем ключ для удаления
        table.insert(orphanedKeys, key)
      end
    end
  
    -- Удаляем orphaned/поврежденные ключи из набора
    for _, orphanedKey in ipairs(orphanedKeys) do
      redis.call('SREM', userTokensKey, orphanedKey)
    end
  
    -- Собираем список устройств
    local devices = {}
    for deviceId, _ in pairs(deviceSet) do
      table.insert(devices, deviceId)
    end
  
    return {activeTokens, totalTokens, devices}
  `;
}
