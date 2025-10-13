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

  rotate(
    oldToken: string,
    newToken: string,
    newTokenData: TokenData,
    ttl: number
  ): Promise<void> {
    throw new Error("Method not implemented.");
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

  private getTokenKey(token: string): string {
    return `${this.keyPrefix}:${token}`;
  }
}
