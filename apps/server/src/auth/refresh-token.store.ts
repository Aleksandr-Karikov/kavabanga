import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";
import Joi from "joi";

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

export interface RefreshTokenData {
  userId: string;
  deviceId: string;
  issuedAt: number;
  used: boolean;
}

const RefreshTokenDataSchema = Joi.object({
  userId: Joi.string().required(),
  deviceId: Joi.string().required(),
  issuedAt: Joi.number().required(),
  used: Joi.boolean().required(),
});

@Injectable()
export class RefreshTokenStore {
  private readonly logger = new Logger(RefreshTokenStore.name);
  private readonly ttlSeconds: number;
  private readonly usedTokenTtlSeconds: number;
  private readonly refreshTokenRedisPrefix = "refresh";
  private readonly userTokensPrefix: string;

  private readonly MAX_SCRIPT_ATTEMPTS = 2;
  private readonly SCRIPT_NAMES = {
    SAVE: "save",
    MARK_USED: "markUsed",
    DELETE: "delete",
    REVOKE_ALL: "revokeAll",
    REVOKE_DEVICE: "revokeDevice",
  } as const;

  private scriptHashes: Record<string, string> = {
    [this.SCRIPT_NAMES.SAVE]: "",
    [this.SCRIPT_NAMES.MARK_USED]: "",
    [this.SCRIPT_NAMES.DELETE]: "",
    [this.SCRIPT_NAMES.REVOKE_ALL]: "",
    [this.SCRIPT_NAMES.REVOKE_DEVICE]: "",
  };

  constructor(
    private readonly redis: Redis,
    configService: ConfigService
  ) {
    const refreshTokenTtlDays = configService.get<number>(
      "REFRESH_TOKEN_TTL_DAYS",
      7
    );
    const usedTokenTtlMinutes = configService.get<number>(
      "USED_TOKEN_TTL_MINUTES",
      5
    );
    this.userTokensPrefix = configService.get<string>(
      "REDIS_USER_TOKENS_PREFIX",
      "user_tokens"
    );

    this.ttlSeconds = 60 * 60 * 24 * refreshTokenTtlDays;
    this.usedTokenTtlSeconds = 60 * usedTokenTtlMinutes;

    this.initializeScripts().catch((err) => {
      this.logger.error("Failed to initialize Lua scripts", err);
      throw new Error("RefreshTokenStore initialization failed");
    });
  }

  /**
   * Initializes Lua scripts in Redis and stores their hashes
   */
  private async initializeScripts(): Promise<void> {
    try {
      this.scriptHashes[this.SCRIPT_NAMES.SAVE] = (await this.redis.script(
        "LOAD",
        this.SAVE_SCRIPT
      )) as string;

      this.scriptHashes[this.SCRIPT_NAMES.MARK_USED] = (await this.redis.script(
        "LOAD",
        this.MARK_USED_SCRIPT
      )) as string;

      this.scriptHashes[this.SCRIPT_NAMES.DELETE] = (await this.redis.script(
        "LOAD",
        this.DELETE_SCRIPT
      )) as string;

      this.scriptHashes[this.SCRIPT_NAMES.REVOKE_ALL] =
        (await this.redis.script("LOAD", this.REVOKE_ALL_SCRIPT)) as string;

      this.scriptHashes[this.SCRIPT_NAMES.REVOKE_DEVICE] =
        (await this.redis.script("LOAD", this.REVOKE_DEVICE_SCRIPT)) as string;
    } catch (error) {
      this.logger.error("Lua script loading failed", { error });
      throw new RefreshTokenStoreError("Failed to initialize Lua scripts", {
        error,
      });
    }
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
   * Executes script with NOSCRIPT error recovery and attempt limiting
   */
  private async evalScript(
    scriptName: keyof typeof this.scriptHashes,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    let attempts = 0;

    while (attempts < this.MAX_SCRIPT_ATTEMPTS) {
      try {
        return await this.redis.evalsha(
          this.scriptHashes[scriptName],
          numKeys,
          ...args
        );
      } catch (error) {
        if (
          error.message.includes("NOSCRIPT") &&
          attempts < this.MAX_SCRIPT_ATTEMPTS - 1
        ) {
          this.logger.warn(
            `Reloading Lua script (${scriptName}) due to NOSCRIPT error`
          );
          await this.initializeScripts();
          attempts++;
          continue;
        }
        throw error;
      }
    }
    throw new Error(
      `Max script execution attempts (${this.MAX_SCRIPT_ATTEMPTS}) reached`
    );
  }

  /**
   * Retrieves token data from Redis
   * @param token - The refresh token
   * @returns Token data or null if not found
   * @throws TokenValidationError if data is invalid
   */
  async getTokenData(token: string): Promise<RefreshTokenData | null> {
    const key = this.getKey(token);
    const raw = await this.redis.get(key);
    if (!raw) return null;

    try {
      const parsedData = JSON.parse(raw);
      this.validateTokenData(parsedData);
      return parsedData;
    } catch (error) {
      this.logger.error("Invalid token data format", { token, error, raw });
      throw new TokenValidationError("Invalid token data format", {
        token,
        error,
      });
    }
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
    const fullData: RefreshTokenData = {
      ...data,
      issuedAt: Date.now(),
      used: false,
    };

    this.validateTokenData(fullData);
    const key = this.getKey(token);
    const userTokensKey = this.getUserTokensKey(data.userId);

    try {
      const result = await this.evalScript(
        this.SCRIPT_NAMES.SAVE,
        3,
        key,
        data.userId,
        userTokensKey,
        this.ttlSeconds,
        JSON.stringify(fullData)
      );

      if (result !== 1) {
        throw new TokenOperationFailedError("Failed to save token", {
          token,
          userId: data.userId,
        });
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw new TokenAlreadyExistsError("Token already exists", { token });
      }
      this.logger.error("Failed to save token", { error, token });
      throw new TokenOperationFailedError("Failed to save token", {
        token,
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
    const key = this.getKey(token);
    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.evalScript(
        this.SCRIPT_NAMES.MARK_USED,
        3,
        key,
        userId,
        userTokensKey,
        this.usedTokenTtlSeconds
      );
      return result === 1;
    } catch (error) {
      this.logger.error("Failed to mark token as used", { error, token });
      throw new TokenOperationFailedError("Failed to mark token as used", {
        token,
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
    const key = this.getKey(token);
    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.evalScript(
        this.SCRIPT_NAMES.DELETE,
        3,
        key,
        userId,
        userTokensKey
      );
      return result === 1;
    } catch (error) {
      this.logger.error("Failed to delete token", { error, token });
      throw new TokenOperationFailedError("Failed to delete token", {
        token,
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
    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.evalScript(
        this.SCRIPT_NAMES.REVOKE_ALL,
        1,
        userTokensKey
      );
      return Number(result);
    } catch (error) {
      this.logger.error("Failed to revoke all tokens", { error, userId });
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
    const userTokensKey = this.getUserTokensKey(userId);

    try {
      const result = await this.evalScript(
        this.SCRIPT_NAMES.REVOKE_DEVICE,
        2,
        userTokensKey,
        deviceId
      );
      return Number(result);
    } catch (error) {
      this.logger.error("Failed to revoke device tokens", {
        error,
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
   * Lua script to save a new token
   * Verifies token doesn't exist, sets it with TTL, and adds to user's token set
   */
  private readonly SAVE_SCRIPT = `
    local key = KEYS[1]
    local userId = KEYS[2]
    local userTokensKey = KEYS[3]
    local ttl = ARGV[1]
    local data = ARGV[2]

    -- Verify token doesn't exist
    if redis.call('EXISTS', key) == 1 then
      return redis.error_reply("Token already exists")
    end
    
    -- Verify userId in data matches
    local parsedData = cjson.decode(data)
    if parsedData.userId ~= userId then
      return redis.error_reply("User ID mismatch")
    end
    
    -- Save token and add to user's set
    redis.call('SET', key, data, 'EX', ttl)
    redis.call('SADD', userTokensKey, key)
    return 1
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

    local parsed = cjson.decode(data)
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

    local parsed = cjson.decode(data)
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
        local parsed = cjson.decode(data)
        if parsed.deviceId == deviceId then
          redis.call('DEL', key)
          redis.call('SREM', userTokensKey, key)
          removed = removed + 1
        end
      end
    end
    return removed
  `;
}
