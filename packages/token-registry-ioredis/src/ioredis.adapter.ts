import { ITokenStore, TokenData } from "@kavabanga/token-registry-core";
import { Redis, Cluster } from "ioredis";

export interface IoredisStoreOptions {
  /** Custom prefix for token keys. Default: 'token' */
  keyPrefix?: string;
}

export class IoredisStore implements ITokenStore {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: Redis | Cluster,
    options: IoredisStoreOptions = {}
  ) {
    this.keyPrefix = options.keyPrefix || "token";
  }

  async save(token: string, data: TokenData, ttl: number): Promise<void> {
    const key = this.getTokenKey(token);
    await this.redis.setex(key, ttl, JSON.stringify(data));
  }

  async get(token: string): Promise<TokenData | null> {
    const key = this.getTokenKey(token);
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async delete(token: string): Promise<void> {
    const key = this.getTokenKey(token);
    await this.redis.del(key);
  }

  async health(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  // ===================== UTILITY METHODS =====================

  /**
   * Gets all tokens for a specific user using SCAN
   */
  async getUserTokens(
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
   * Revokes all tokens for a specific user
   */
  async revokeUserTokens(userId: string): Promise<number> {
    const userTokens = await this.getUserTokens(userId);
    if (userTokens.length === 0) {
      return 0;
    }

    const keys = userTokens.map(({ token }) => this.getTokenKey(token));
    const deletedCount = await this.redis.del(...keys);
    return deletedCount;
  }

  /**
   * Revokes tokens for a specific user and device
   */
  async revokeTokensByDevice(
    userId: string,
    deviceId: string
  ): Promise<number> {
    const userTokens = await this.getUserTokens(userId);
    const deviceTokens = userTokens.filter(
      ({ data }) => data.meta.deviceId === deviceId
    );

    if (deviceTokens.length === 0) {
      return 0;
    }

    const keys = deviceTokens.map(({ token }) => this.getTokenKey(token));
    const deletedCount = await this.redis.del(...keys);
    return deletedCount;
  }

  /**
   * Gets all tokens for a specific user and device
   */
  async getUserDeviceTokens(
    userId: string,
    deviceId: string
  ): Promise<Array<{ token: string; data: TokenData }>> {
    const userTokens = await this.getUserTokens(userId);
    return userTokens.filter(({ data }) => data.meta.deviceId === deviceId);
  }

  /**
   * Gets count of active tokens (for monitoring)
   */
  async getActiveTokenCount(): Promise<number> {
    const pattern = `${this.keyPrefix}:*`;
    let count = 0;
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
      count += scanResult[1].length;
    } while (cursor !== "0");

    return count;
  }

  /**
   * Cleans up expired tokens (for maintenance)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const pattern = `${this.keyPrefix}:*`;
    let cleanedCount = 0;
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

      // Check TTL for each key
      const pipeline = this.redis.pipeline();
      for (const key of keys) {
        pipeline.ttl(key);
      }

      const results = await pipeline.exec();
      const expiredKeys: string[] = [];

      if (results) {
        for (let i = 0; i < keys.length; i++) {
          const result = results[i];
          if (result && result[1] === -2) {
            // TTL = -2 means key doesn't exist (expired)
            const key = keys[i];
            if (key) {
              expiredKeys.push(key);
            }
          }
        }
      }

      if (expiredKeys.length > 0) {
        await this.redis.del(...expiredKeys);
        cleanedCount += expiredKeys.length;
      }
    } while (cursor !== "0");

    return cleanedCount;
  }

  // ===================== PRIVATE METHODS =====================

  private getTokenKey(token: string): string {
    return `${this.keyPrefix}:${token}`;
  }
}
