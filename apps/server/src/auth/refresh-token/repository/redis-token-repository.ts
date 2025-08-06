import { InjectRedis } from "@nestjs-modules/ioredis";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Redis } from "ioredis";
import {
  RefreshTokenData,
  RefreshTokenStoreConfiguration,
  TokenValidationError,
  ExtendedRedis,
} from "../refresh-token.types";

@Injectable()
export class RedisTokenRepository implements OnModuleInit {
  private readonly logger = new Logger(RedisTokenRepository.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly configuration: RefreshTokenStoreConfiguration
  ) {}

  async onModuleInit() {
    await this.initializeScripts();
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
   * Retrieves token data from Redis
   */
  async getTokenData(token: string): Promise<RefreshTokenData | null> {
    if (!token?.trim()) {
      return null;
    }

    const key = this.getTokenKey(token);
    const raw = await this.redis.get(key);

    if (raw === null) return null;

    try {
      const parsedData = JSON.parse(raw);
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

  /**
   * Saves a token using Lua script
   */
  async saveToken(
    token: string,
    data: RefreshTokenData,
    userId: string
  ): Promise<number> {
    const key = this.getTokenKey(token);
    const userTokensKey = this.getUserTokensKey(userId);

    return await this.redisTyped.saveToken(
      key,
      userId,
      userTokensKey,
      this.configuration.ttl,
      JSON.stringify(data)
    );
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

    const userTokensKey = this.getUserTokensKey(userId);
    const args: string[] = [userTokensKey];

    for (const { token, data } of userTokens) {
      const key = this.getTokenKey(token);
      args.push(key, JSON.stringify(data), this.configuration.ttl.toString());
    }

    return await this.redisTyped.saveBatchTokens(userTokensKey, ...args);
  }

  /**
   * Marks token as used
   */
  async markTokenUsed(token: string, userId: string): Promise<number> {
    const key = this.getTokenKey(token);
    const userTokensKey = this.getUserTokensKey(userId);

    return await this.redisTyped.markTokenUsed(
      key,
      userId,
      userTokensKey,
      this.configuration.usedTokenTtl
    );
  }

  /**
   * Deletes a token
   */
  async deleteToken(token: string, userId: string): Promise<number> {
    const key = this.getTokenKey(token);
    const userTokensKey = this.getUserTokensKey(userId);

    return await this.redisTyped.deleteToken(key, userId, userTokensKey);
  }

  /**
   * Revokes all user tokens
   */
  async revokeAllTokens(userId: string): Promise<number> {
    const userTokensKey = this.getUserTokensKey(userId);
    return await this.redisTyped.revokeAllTokens(userTokensKey);
  }

  /**
   * Revokes device tokens
   */
  async revokeDeviceTokens(userId: string, deviceId: string): Promise<number> {
    const userTokensKey = this.getUserTokensKey(userId);
    return await this.redisTyped.revokeDeviceTokens(userTokensKey, deviceId);
  }

  /**
   * Gets user token stats using optimized Lua script
   */
  async getUserTokenStatsOptimized(
    userId: string,
    maxBatchSize: number,
    statsKey: string,
    statsCacheTtl: number
  ): Promise<[number, number, string[]]> {
    const userTokensKey = this.getUserTokensKey(userId);

    return await this.redisTyped.getUserTokenStatsOptimized(
      userTokensKey,
      maxBatchSize.toString(),
      statsKey,
      statsCacheTtl.toString()
    );
  }

  /**
   * Performs cleanup for a specific user
   */
  async cleanupUserExpiredTokens(userId: string): Promise<number> {
    const userTokensKey = this.getUserTokensKey(userId);
    return await this.redisTyped.cleanupExpiredTokens(userTokensKey);
  }

  /**
   * Scans for all user token keys
   */
  async scanUserTokenKeys(
    cursor: string = "0",
    batchSize: number = 200
  ): Promise<[string, string[]]> {
    return await this.redis.scan(
      cursor,
      "MATCH",
      `${this.configuration.userTokensSetRedisPrefix}:*`,
      "COUNT",
      batchSize
    );
  }

  /**
   * Deletes cache key
   */
  async deleteKey(key: string): Promise<number> {
    return await this.redis.del(key);
  }

  /**
   * Creates a pipeline for batch operations
   */
  createPipeline() {
    return this.redis.pipeline();
  }

  /**
   * Initializes Lua scripts in Redis
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
