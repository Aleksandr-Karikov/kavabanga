import {
  BaseStoreAdapter,
  TokenData,
  TokenSaveRequest,
} from "@kavabanga/token-registry-core";
import { Redis } from "ioredis";

export interface IoredisAdapterOptions {
  /** Custom prefix for token keys. Default: 'token' */
  keyPrefix?: string;
  /** Whether to use user sets for efficient user token management. Default: true */
  useUserSets?: boolean;
}

export class IoredisStoreAdapter extends BaseStoreAdapter {
  private readonly keyPrefix: string;
  private readonly useUserSets: boolean;

  // Lua scripts for atomic operations
  private readonly luaScripts = {
    saveToken: `
      local tokenKey = KEYS[1]
      local userSetKey = KEYS[2] 
      local data = ARGV[1]
      local ttl = ARGV[2]
      local useUserSets = ARGV[3]
      
      -- Save token with TTL
      redis.call('SET', tokenKey, data, 'EX', ttl)
      
      -- Add to user set if enabled
      if useUserSets == '1' then
        redis.call('SADD', userSetKey, tokenKey)
        
        -- Set user set TTL to be longer than any individual token
        -- but refresh it on each new token to prevent premature expiration
        local currentTTL = redis.call('TTL', userSetKey)
        local newTTL = ttl + 86400 -- 24 hours buffer
        
        if currentTTL == -1 or currentTTL < newTTL then
          redis.call('EXPIRE', userSetKey, newTTL)
        end
        
        -- Store cleanup info for this token
        local cleanupKey = tokenKey .. ':cleanup'
        redis.call('SET', cleanupKey, userSetKey, 'EX', ttl)
      end
      
      return 1
    `,

    getUserTokens: `
      local userSetKey = KEYS[1]
      local useUserSets = ARGV[1]
      
      if useUserSets == '1' then
        -- Use efficient SMEMBERS if user sets are enabled
        local tokenKeys = redis.call('SMEMBERS', userSetKey)
        local result = {}
        local staleKeys = {}
        
        for i, tokenKey in ipairs(tokenKeys) do
          local data = redis.call('GET', tokenKey)
          if data then
            result[#result + 1] = tokenKey
            result[#result + 1] = data  
          else
            -- Collect stale references for cleanup
            staleKeys[#staleKeys + 1] = tokenKey
          end
        end
        
        -- Batch cleanup of stale references
        if #staleKeys > 0 then
          redis.call('SREM', userSetKey, unpack(staleKeys))
          
          -- If user set is now empty, delete it
          local remainingCount = redis.call('SCARD', userSetKey)
          if remainingCount == 0 then
            redis.call('DEL', userSetKey)
          end
        end
        
        return result
      else
        -- Return empty array for fallback mode - will be handled in JS
        return {}
      end
    `,

    cleanupUserSets: `
      local pattern = ARGV[1] .. ':users:*'
      local cursor = '0'
      local cleanedSets = 0
      local cleanedReferences = 0
      
      repeat
        local scanResult = redis.call('SCAN', cursor, 'MATCH', pattern, 'COUNT', 100)
        cursor = scanResult[1]
        local userSetKeys = scanResult[2]
        
        for i, userSetKey in ipairs(userSetKeys) do
          local tokenKeys = redis.call('SMEMBERS', userSetKey)
          local staleKeys = {}
          
          for j, tokenKey in ipairs(tokenKeys) do
            local exists = redis.call('EXISTS', tokenKey)
            if exists == 0 then
              staleKeys[#staleKeys + 1] = tokenKey
            end
          end
          
          if #staleKeys > 0 then
            redis.call('SREM', userSetKey, unpack(staleKeys))
            cleanedReferences = cleanedReferences + #staleKeys
          end
          
          -- Check if user set is now empty
          local remainingCount = redis.call('SCARD', userSetKey)
          if remainingCount == 0 then
            redis.call('DEL', userSetKey)
            cleanedSets = cleanedSets + 1
          end
        end
      until cursor == '0'
      
      return {cleanedSets, cleanedReferences}
    `,

    revokeUserTokens: `
      local userSetKey = KEYS[1]
      local useUserSets = ARGV[1]
      
      if useUserSets == '1' then
        -- Use efficient SMEMBERS + DEL
        local tokenKeys = redis.call('SMEMBERS', userSetKey)
        if #tokenKeys > 0 then
          redis.call('DEL', unpack(tokenKeys))
          redis.call('DEL', userSetKey)
        end
        return #tokenKeys
      else
        -- Return 0 for fallback mode - will be handled in JS
        return 0
      end
    `,

    revokeTokensByDevice: `
      local userSetKey = KEYS[1]
      local useUserSets = ARGV[1]
      local deviceId = ARGV[2]
      
      if useUserSets == '1' then
        local tokenKeys = redis.call('SMEMBERS', userSetKey)
        local deletedCount = 0
        local keysToRemove = {}
        
        for i, tokenKey in ipairs(tokenKeys) do
          local data = redis.call('GET', tokenKey)
          if data then
            -- Simple string matching instead of JSON parsing for compatibility
            local devicePattern = '"deviceId":"' .. deviceId .. '"'
            if string.find(data, devicePattern, 1, true) then
              redis.call('DEL', tokenKey)
              keysToRemove[#keysToRemove + 1] = tokenKey
              deletedCount = deletedCount + 1
            end
          else
            -- Clean up stale reference
            keysToRemove[#keysToRemove + 1] = tokenKey
          end
        end
        
        if #keysToRemove > 0 then
          redis.call('SREM', userSetKey, unpack(keysToRemove))
        end
        
        return deletedCount
      else
        -- Return 0 for fallback mode - will be handled in JS
        return 0
      end
    `,

    deleteToken: `
      local tokenKey = KEYS[1]
      local useUserSets = ARGV[1]
      
      -- Get token data first to extract userId
      local data = redis.call('GET', tokenKey)
      if not data then
        return 0 -- Token doesn't exist
      end
      
      -- Delete token
      local deleted = redis.call('DEL', tokenKey)
      
      -- Remove from user set if enabled and deletion was successful
      if useUserSets == '1' and deleted > 0 then
        -- Extract userId from JSON data using simple pattern matching
        local userIdPattern = '"sub":"([^"]*)"'
        local userId = string.match(data, userIdPattern)
        
        if userId then
          -- Construct user set key dynamically
          local prefix = string.match(tokenKey, '^([^:]*):')
          if prefix then
            local userSetKey = prefix .. ':users:' .. userId
            redis.call('SREM', userSetKey, tokenKey)
          end
        end
      end
      
      return deleted
    `,
  };

  constructor(
    private readonly redis: Redis,
    options: IoredisAdapterOptions = {}
  ) {
    super();
    this.keyPrefix = options.keyPrefix || "token";
    this.useUserSets = options.useUserSets !== false; // Default to true
  }

  /**
   * Override getTokenKey to use custom prefix
   */
  protected getTokenKey(token: string): string {
    return `${this.keyPrefix}:${token}`;
  }

  /**
   * Get user set key for efficient user token management
   */
  private getUserSetKey(userId: string): string {
    return `${this.keyPrefix}:users:${userId}`;
  }

  async saveToken(request: TokenSaveRequest): Promise<void> {
    try {
      this.validateToken(request.token);

      const tokenKey = this.getTokenKey(request.token);
      const userSetKey = this.getUserSetKey(request.data.sub);

      await this.redis.eval(
        this.luaScripts.saveToken,
        2,
        tokenKey,
        userSetKey,
        JSON.stringify(request.data),
        request.ttl.toString(),
        this.useUserSets ? "1" : "0"
      );
    } catch (error) {
      this.handleError("saveToken", error, { token: request.token });
    }
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    try {
      this.validateToken(token);

      const key = this.getTokenKey(token);
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.handleError("getTokenData", error, { token });
    }
  }

  async deleteToken(token: string): Promise<void> {
    try {
      this.validateToken(token);

      const tokenKey = this.getTokenKey(token);

      if (this.useUserSets) {
        // Use fully atomic Lua script that handles everything in one operation
        await this.redis.eval(this.luaScripts.deleteToken, 1, tokenKey, "1");
      } else {
        // Simple delete in fallback mode
        await this.redis.del(tokenKey);
      }
    } catch (error) {
      this.handleError("deleteToken", error, { token });
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  // ===================== ADDITIONAL REDIS-SPECIFIC METHODS =====================

  /**
   * Gets all tokens for a specific user (optimized with Lua scripts)
   */
  async getUserTokens(
    userId: string
  ): Promise<Array<{ token: string; data: TokenData }>> {
    try {
      if (this.useUserSets) {
        // Use optimized Lua script with user sets
        const userSetKey = this.getUserSetKey(userId);

        const result = (await this.redis.eval(
          this.luaScripts.getUserTokens,
          1,
          userSetKey,
          "1"
        )) as string[];

        const userTokens: Array<{ token: string; data: TokenData }> = [];

        // Process pairs of [tokenKey, tokenData]
        for (let i = 0; i < result.length; i += 2) {
          const tokenKey = result[i];
          const tokenData = result[i + 1];

          if (tokenKey && tokenData) {
            try {
              const data = JSON.parse(tokenData) as TokenData;
              const token = tokenKey.replace(`${this.keyPrefix}:`, "");
              userTokens.push({ token, data });
            } catch (parseError) {
              // Skip invalid JSON entries
              continue;
            }
          }
        }

        return userTokens;
      } else {
        // Fallback: use SCAN to find tokens by pattern
        return await this.getUserTokensFallback(userId);
      }
    } catch (error) {
      this.handleError("getUserTokens", error, { userId });
    }
  }

  /**
   * Fallback method for getUserTokens when user sets are disabled
   */
  private async getUserTokensFallback(
    userId: string
  ): Promise<Array<{ token: string; data: TokenData }>> {
    const pattern = `${this.keyPrefix}:*`;
    const userTokens: Array<{ token: string; data: TokenData }> = [];
    let cursor = "0";

    do {
      const scanResult = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = scanResult[0];
      const keys = scanResult[1];

      // Use pipeline for efficiency
      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.get(key);
      }

      const results = await pipeline.exec();

      if (results) {
        for (let i = 0; i < keys.length; i++) {
          const result = results[i];
          if (result && result[1]) {
            try {
              const data = JSON.parse(result[1] as string) as TokenData;
              if (data.sub === userId) {
                const token = keys[i]?.replace(`${this.keyPrefix}:`, "") ?? "";
                userTokens.push({ token, data });
              }
            } catch (parseError) {
              // Skip invalid JSON entries
              continue;
            }
          }
        }
      }
    } while (cursor !== "0");

    return userTokens;
  }

  /**
   * Revokes all tokens for a specific user (atomic operation)
   */
  async revokeUserTokens(userId: string): Promise<number> {
    try {
      if (this.useUserSets) {
        const userSetKey = this.getUserSetKey(userId);

        const deletedCount = (await this.redis.eval(
          this.luaScripts.revokeUserTokens,
          1,
          userSetKey,
          "1"
        )) as number;

        return deletedCount;
      } else {
        // Fallback: get user tokens first, then delete them
        const userTokens = await this.getUserTokens(userId);
        if (userTokens.length === 0) {
          return 0;
        }

        const keys = userTokens.map(({ token }) => this.getTokenKey(token));
        const deletedCount = await this.redis.del(...keys);
        return deletedCount;
      }
    } catch (error) {
      this.handleError("revokeUserTokens", error, { userId });
    }
  }

  /**
   * Revokes tokens for a specific user and device (atomic operation)
   */
  async revokeTokensByDevice(
    userId: string,
    deviceId: string
  ): Promise<number> {
    try {
      if (this.useUserSets) {
        // Use atomic Lua script for optimized mode
        const userSetKey = this.getUserSetKey(userId);

        const deletedCount = (await this.redis.eval(
          this.luaScripts.revokeTokensByDevice,
          1,
          userSetKey,
          "1",
          deviceId
        )) as number;

        return deletedCount;
      } else {
        // Fallback: more atomic approach using pipeline
        const userTokens = await this.getUserTokens(userId);
        const deviceTokens = userTokens.filter(
          ({ data }) => data.meta.deviceId === deviceId
        );

        if (deviceTokens.length === 0) {
          return 0;
        }

        // Use pipeline for better atomicity in fallback mode
        const pipeline = this.redis.pipeline();
        const keys = deviceTokens.map(({ token }) => this.getTokenKey(token));

        for (const key of keys) {
          pipeline.del(key);
        }

        const results = await pipeline.exec();

        // Count successful deletions
        let deletedCount = 0;
        if (results) {
          for (const result of results) {
            if (result && result[1] === 1) {
              deletedCount++;
            }
          }
        }

        return deletedCount;
      }
    } catch (error) {
      this.handleError("revokeTokensByDevice", error, { userId, deviceId });
    }
  }

  /**
   * Gets all tokens for a specific user and device
   */
  async getUserDeviceTokens(
    userId: string,
    deviceId: string
  ): Promise<Array<{ token: string; data: TokenData }>> {
    try {
      const userTokens = await this.getUserTokens(userId);
      return userTokens.filter(({ data }) => data.meta.deviceId === deviceId);
    } catch (error) {
      this.handleError("getUserDeviceTokens", error, { userId, deviceId });
    }
  }

  /**
   * Gets count of active tokens for a user (optimized)
   */
  async getUserTokenCount(userId: string): Promise<number> {
    try {
      if (this.useUserSets) {
        // Use efficient SCARD when user sets are enabled
        const userSetKey = this.getUserSetKey(userId);
        return await this.redis.scard(userSetKey);
      } else {
        // Fallback to getUserTokens
        const userTokens = await this.getUserTokens(userId);
        return userTokens.length;
      }
    } catch (error) {
      this.handleError("getUserTokenCount", error, { userId });
    }
  }

  /**
   * Gets basic statistics about stored tokens
   * Note: For production use, implement separate counters/analytics instead of scanning
   */
  async getTokenStats(): Promise<{
    totalTokens: number;
    userSetsEnabled: boolean;
    keyPrefix: string;
    warning?: string;
  }> {
    try {
      if (this.useUserSets) {
        // In optimized mode, avoid expensive operations
        return {
          totalTokens: -1, // -1 indicates stats unavailable in optimized mode
          userSetsEnabled: true,
          keyPrefix: this.keyPrefix,
          warning:
            "Total token count unavailable in optimized mode. Use separate analytics for production stats.",
        };
      } else {
        // Fallback mode - use SCAN instead of KEYS for better performance
        const pattern = `${this.keyPrefix}:*`;
        let totalTokens = 0;
        let cursor = "0";

        do {
          const scanResult = await this.redis.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            1000
          );
          cursor = scanResult[0];
          totalTokens += scanResult[1].length;
        } while (cursor !== "0");

        return {
          totalTokens,
          userSetsEnabled: false,
          keyPrefix: this.keyPrefix,
          warning:
            "Token counting in fallback mode can be slow on large datasets.",
        };
      }
    } catch (error) {
      this.handleError("getTokenStats", error);
    }
  }

  /**
   * Performs maintenance cleanup of stale user set references
   * Call this periodically (e.g., via cron job) to prevent memory leaks
   *
   * @returns Object with cleanup statistics
   */
  async cleanupUserSets(): Promise<{
    cleanedSets: number;
    cleanedReferences: number;
    userSetsEnabled: boolean;
  }> {
    try {
      if (!this.useUserSets) {
        return {
          cleanedSets: 0,
          cleanedReferences: 0,
          userSetsEnabled: false,
        };
      }

      const result = (await this.redis.eval(
        this.luaScripts.cleanupUserSets,
        0,
        this.keyPrefix
      )) as [number, number];

      return {
        cleanedSets: result[0],
        cleanedReferences: result[1],
        userSetsEnabled: true,
      };
    } catch (error) {
      this.handleError("cleanupUserSets", error);
    }
  }

  /**
   * Gets information about user sets for monitoring
   */
  async getUserSetsInfo(): Promise<{
    totalUserSets: number;
    userSetsEnabled: boolean;
    avgTokensPerSet?: number;
  }> {
    try {
      if (!this.useUserSets) {
        return {
          totalUserSets: 0,
          userSetsEnabled: false,
        };
      }

      const pattern = `${this.keyPrefix}:users:*`;
      let totalSets = 0;
      let totalTokens = 0;
      let cursor = "0";

      do {
        const scanResult = await this.redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          1000
        );
        cursor = scanResult[0];
        const userSetKeys = scanResult[1];

        totalSets += userSetKeys.length;

        // Get cardinality of each set for average calculation
        const pipeline = this.redis.pipeline();
        for (const setKey of userSetKeys) {
          pipeline.scard(setKey);
        }

        const results = await pipeline.exec();
        if (results) {
          for (const result of results) {
            if (result && typeof result[1] === "number") {
              totalTokens += result[1];
            }
          }
        }
      } while (cursor !== "0");

      return {
        totalUserSets: totalSets,
        userSetsEnabled: true,
        avgTokensPerSet: totalSets > 0 ? totalTokens / totalSets : 0,
      };
    } catch (error) {
      this.handleError("getUserSetsInfo", error);
    }
  }
}
