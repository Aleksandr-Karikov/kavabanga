import { InjectRedis } from "@nestjs-modules/ioredis";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";
import {
  RefreshTokenData,
  RefreshTokenStoreConfiguration,
  TokenValidationError,
  TokenOperationFailedError,
  ExtendedRedis,
  InitializationError,
} from "../refresh-token.types";
import { ITokenRepository } from "./token-repository.interface";

@Injectable()
export class RedisTokenRepository implements OnModuleInit, ITokenRepository {
  private readonly logger = new Logger(RedisTokenRepository.name);
  private scriptsInitialized = false;
  private readonly initializationPromise: Promise<void>;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly configuration: RefreshTokenStoreConfiguration
  ) {
    this.initializationPromise = this.initializeScripts();
  }

  async onModuleInit() {
    await this.ensureScriptsInitialized();
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutting down RedisTokenRepository (${signal})`);

    try {
      await this.redis.quit();
      this.logger.log("Redis connection closed successfully");
    } catch (error) {
      this.logger.error("Error during shutdown", error);
      this.redis.disconnect();
    }
  }

  /**
   * Ensures Lua scripts are initialized before any operation
   */
  private async ensureScriptsInitialized(): Promise<void> {
    if (this.scriptsInitialized) return;

    await this.initializationPromise;
  }

  /**
   * Generates Redis key for the token
   */
  getTokenKey(token: string): string {
    return `${this.configuration.refreshTokenRedisPrefix}:${token}`;
  }

  /**
   * Generates key for user's token set
   */
  getUserTokensKey(userId: string): string {
    return `${this.configuration.userTokensSetRedisPrefix}:${userId}`;
  }

  /**
   * Generates key for user's stats cache
   */
  getUserStatsKey(userId: string): string {
    return `${this.configuration.userTokensSetRedisPrefix}:stats:${userId}`;
  }

  private get redisTyped(): ExtendedRedis {
    return this.redis as ExtendedRedis;
  }

  /**
   * Retrieves token data from Redis with improved error handling
   */
  async getTokenData(token: string): Promise<RefreshTokenData | null> {
    if (!token?.trim() || token.length > this.configuration.maxTokenLength) {
      return null;
    }

    await this.ensureScriptsInitialized();

    try {
      const key = this.getTokenKey(token);
      const raw = await this.redis.get(key);

      if (raw === null) return null;

      const parsedData = JSON.parse(raw);
      this.validateParsedTokenData(parsedData, token);

      return parsedData;
    } catch (error) {
      if (error instanceof TokenValidationError) {
        throw error;
      }

      this.logger.error("Failed to retrieve token data", {
        token: token.substring(0, 10) + "...",
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof SyntaxError) {
        throw new TokenValidationError("Invalid token data format", {
          token: token.substring(0, 10) + "...",
          error,
        });
      }

      throw new TokenOperationFailedError("Failed to retrieve token data", {
        token: token.substring(0, 10) + "...",
        error,
      });
    }
  }

  /**
   * Validates parsed token data structure
   */
  private validateParsedTokenData(data: RefreshTokenData, token: string): void {
    if (!data || typeof data !== "object") {
      throw new TokenValidationError("Invalid token data structure", {
        token: token.substring(0, 10) + "...",
      });
    }

    const requiredFields = ["userId", "deviceId", "issuedAt", "used"];
    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new TokenValidationError(`Missing required field: ${field}`, {
          token: token.substring(0, 10) + "...",
          field,
        });
      }
    }

    if (typeof data.userId !== "string" || typeof data.deviceId !== "string") {
      throw new TokenValidationError("userId and deviceId must be strings", {
        token: token.substring(0, 10) + "...",
      });
    }

    if (typeof data.issuedAt !== "number" || typeof data.used !== "boolean") {
      throw new TokenValidationError("Invalid field types in token data", {
        token: token.substring(0, 10) + "...",
      });
    }
  }

  /**
   * Saves a token using Lua script with improved validation
   */
  async saveToken(
    token: string,
    data: RefreshTokenData,
    userId: string
  ): Promise<number> {
    await this.ensureScriptsInitialized();

    try {
      const key = this.getTokenKey(token);
      const userTokensKey = this.getUserTokensKey(userId);
      const serializedData = JSON.stringify(data);

      const result = await this.redisTyped.saveToken(
        key,
        userId,
        userTokensKey,
        this.configuration.ttl,
        serializedData
      );

      if (result === 0) {
        throw new TokenOperationFailedError(
          "Token already exists or validation failed"
        );
      }

      return result;
    } catch (error) {
      this.logger.error("Failed to save token", {
        token: token.substring(0, 10) + "...",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof TokenOperationFailedError) {
        throw error;
      }

      throw new TokenOperationFailedError("Failed to save token", {
        token: token.substring(0, 10) + "...",
        userId,
        error,
      });
    }
  }

  /**
   * Saves multiple tokens in batch
   */
  async saveBatchTokens(
    userTokens: Array<{
      token: string;
      data: RefreshTokenData;
    }>,
    userId: string
  ): Promise<number> {
    if (userTokens.length === 0) return 0;

    await this.ensureScriptsInitialized();

    try {
      const userTokensKey = this.getUserTokensKey(userId);
      const args: string[] = [userTokensKey];

      for (const { token, data } of userTokens) {
        const key = this.getTokenKey(token);
        args.push(key, JSON.stringify(data), this.configuration.ttl.toString());
      }

      return await this.redisTyped.saveBatchTokens(userTokensKey, ...args);
    } catch (error) {
      this.logger.error("Failed to save batch tokens", {
        userId,
        tokenCount: userTokens.length,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to save batch tokens", {
        userId,
        tokenCount: userTokens.length,
        error,
      });
    }
  }

  /**
   * Marks token as used
   */
  async markTokenUsed(token: string, userId: string): Promise<number> {
    await this.ensureScriptsInitialized();

    try {
      const key = this.getTokenKey(token);
      const userTokensKey = this.getUserTokensKey(userId);

      return await this.redisTyped.markTokenUsed(
        key,
        userId,
        userTokensKey,
        this.configuration.usedTokenTtl
      );
    } catch (error) {
      this.logger.error("Failed to mark token as used", {
        token: token.substring(0, 10) + "...",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to mark token as used", {
        token: token.substring(0, 10) + "...",
        userId,
        error,
      });
    }
  }

  /**
   * Deletes a token with enhanced error handling
   */
  async deleteToken(token: string, userId: string): Promise<number> {
    await this.ensureScriptsInitialized();

    try {
      const key = this.getTokenKey(token);
      const userTokensKey = this.getUserTokensKey(userId);

      return await this.redisTyped.deleteToken(key, userId, userTokensKey);
    } catch (error) {
      this.logger.error("Failed to delete token", {
        token: token.substring(0, 10) + "...",
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to delete token", {
        token: token.substring(0, 10) + "...",
        userId,
        error,
      });
    }
  }

  /**
   * Revokes all user tokens with enhanced error handling
   */
  async revokeAllTokens(userId: string): Promise<number> {
    await this.ensureScriptsInitialized();

    try {
      const userTokensKey = this.getUserTokensKey(userId);
      return await this.redisTyped.revokeAllTokens(userTokensKey);
    } catch (error) {
      this.logger.error("Failed to revoke all tokens", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to revoke all tokens", {
        userId,
        error,
      });
    }
  }

  /**
   * Revokes device tokens with enhanced error handling
   */
  async revokeDeviceTokens(userId: string, deviceId: string): Promise<number> {
    await this.ensureScriptsInitialized();

    try {
      const userTokensKey = this.getUserTokensKey(userId);
      return await this.redisTyped.revokeDeviceTokens(userTokensKey, deviceId);
    } catch (error) {
      this.logger.error("Failed to revoke device tokens", {
        userId,
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to revoke device tokens", {
        userId,
        deviceId,
        error,
      });
    }
  }

  /**
   * Gets user token stats using optimized Lua script
   */
  async getUserTokenStatsOptimized(
    userId: string,
    maxBatchSize: number,
    statsCacheTtl: number
  ): Promise<[number, number, string[]]> {
    await this.ensureScriptsInitialized();

    try {
      const userTokensKey = this.getUserTokensKey(userId);

      return await this.redisTyped.getUserTokenStatsOptimized(
        userTokensKey,
        maxBatchSize.toString(),
        this.getUserStatsKey(userId),
        statsCacheTtl.toString()
      );
    } catch (error) {
      this.logger.error("Failed to get user token stats", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to get user token stats", {
        userId,
        error,
      });
    }
  }

  /**
   * Performs cleanup for a specific user
   */
  async cleanupUserExpiredTokens(userId: string): Promise<number> {
    await this.ensureScriptsInitialized();

    try {
      const userTokensKey = this.getUserTokensKey(userId);
      return await this.redisTyped.cleanupExpiredTokens(userTokensKey);
    } catch (error) {
      this.logger.error("Failed to cleanup expired tokens", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to cleanup expired tokens", {
        userId,
        error,
      });
    }
  }

  /**
   * Scans for all user token keys
   */
  async scanUserTokenKeys(
    cursor: string = "0",
    batchSize: number = 200
  ): Promise<[string, string[]]> {
    try {
      return await this.redis.scan(
        cursor,
        "MATCH",
        `${this.configuration.userTokensSetRedisPrefix}:*`,
        "COUNT",
        batchSize
      );
    } catch (error) {
      this.logger.error("Failed to scan user token keys", {
        cursor,
        batchSize,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to scan user token keys", {
        cursor,
        batchSize,
        error,
      });
    }
  }

  /**
   * Deletes cache key
   */
  async deleteKey(key: string): Promise<number> {
    try {
      return await this.redis.del(key);
    } catch (error) {
      this.logger.error("Failed to delete key", {
        key: key.substring(0, 50) + "...",
        error: error instanceof Error ? error.message : String(error),
      });

      throw new TokenOperationFailedError("Failed to delete key", {
        key: key.substring(0, 50) + "...",
        error,
      });
    }
  }

  async invalidateStatsCache(userId: string) {
    return this.deleteKey(this.getUserStatsKey(userId));
  }

  /**
   * Creates a pipeline for batch operations
   */
  createPipeline() {
    return this.redis.pipeline();
  }

  /**
   * Checks if Redis connection is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      this.logger.error("Redis health check failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Initializes Lua scripts in Redis with proper error handling
   */
  private async initializeScripts(): Promise<void> {
    try {
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

      this.scriptsInitialized = true;
      this.logger.log("Lua scripts initialized successfully");
    } catch (error) {
      this.scriptsInitialized = false;
      this.logger.error("Failed to initialize Lua scripts", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InitializationError("Failed to initialize Lua scripts", {
        error,
      });
    }
  }

  // ===================== LUA SCRIPTS =====================

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

  private readonly REVOKE_ALL_SCRIPT = `
local userTokensKey = KEYS[1]
local tokens = redis.call('SMEMBERS', userTokensKey)

for _, key in ipairs(tokens) do
  redis.call('DEL', key)
end
redis.call('DEL', userTokensKey)
return #tokens
`;

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

if statsKey and statsKey ~= "" then
  local cachedStats = redis.call('HMGET', statsKey, 'active', 'total', 'devices', 'lastUpdated')
  if cachedStats[1] and cachedStats[2] and cachedStats[3] then
    local lastUpdated = tonumber(cachedStats[4]) or 0
    local currentTime = redis.call('TIME')[1]
    
    if (currentTime - lastUpdated) < statsTtl then
      local devices = {}
      if cachedStats[3] and cachedStats[3] ~= "" then
        for device in string.gmatch(cachedStats[3], "([^,]+)") do
          table.insert(devices, device)
        end
      end
      return {tonumber(cachedStats[1]) or 0, tonumber(cachedStats[2]) or 0, devices}
    end
  end
end

local tokens = redis.call('SMEMBERS', userTokensKey)
local tokenCount = #tokens

if tokenCount == 0 then
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
local deviceSet = {} 
local orphanedKeys = {}
local processedTokens = 0

local function processBatch(tokenBatch)
  if #tokenBatch == 0 then return end
  
  local dataArray = redis.call('MGET', unpack(tokenBatch))
  
  for i, data in ipairs(dataArray) do
    local tokenKey = tokenBatch[i]
    
    if data then
      local ok, parsed = pcall(cjson.decode, data)
      
      if ok and type(parsed) == "table" and parsed.userId and parsed.deviceId then
        totalTokens = totalTokens + 1
        
        if not parsed.used then
          activeTokens = activeTokens + 1
        end
        
        deviceSet[parsed.deviceId] = true
      else
        table.insert(orphanedKeys, tokenKey)
      end
    else
      table.insert(orphanedKeys, tokenKey)
    end
  end
end

if tokenCount <= maxBatchSize then
  processBatch(tokens)
else
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
    
    if processedTokens >= 500 then
      local processed_ratio = processedTokens / tokenCount
      activeTokens = math.floor(activeTokens / processed_ratio)
      totalTokens = math.floor(totalTokens / processed_ratio)
      break
    end
  end
end

if #orphanedKeys > 0 then
  local maxCleanup = math.min(#orphanedKeys, 50)
  for i = 1, maxCleanup do
    redis.call('SREM', userTokensKey, orphanedKeys[i])
  end
end

local devices = {}
for deviceId, _ in pairs(deviceSet) do
  table.insert(devices, deviceId)
end

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

return {activeTokens, totalTokens, devices}
`;
}
