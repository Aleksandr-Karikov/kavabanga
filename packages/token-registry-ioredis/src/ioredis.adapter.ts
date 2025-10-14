import {
  ITokenStore,
  TokenData,
  TokenNotFoundError,
  TokenOperationError,
} from "@kavabanga/token-registry-core";
import { Redis, Cluster } from "ioredis";

export interface IoredisStoreOptions {
  /** Custom prefix for token keys. Default: 'token' */
  keyPrefix?: string;
}

export const LUA_SCRIPT_ERROR = {
  OLD_TOKEN_NOT_FOUND: "OLD_TOKEN_NOT_FOUND",
  TOKEN_ALREADY_EXIST: "TOKEN_ALREADY_EXIST",
};

export const DEFAULT_PREFIX = "token";
export class IoredisStore implements ITokenStore {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: Redis | Cluster,
    options: IoredisStoreOptions = {}
  ) {
    this.keyPrefix = options.keyPrefix || DEFAULT_PREFIX;
  }

  async rotate(
    oldToken: string,
    newToken: string,
    newTokenData: TokenData,
    ttl: number
  ): Promise<void> {
    const oldKey = this.getTokenKey(oldToken);
    const newKey = this.getTokenKey(newToken);
    const serialized = JSON.stringify(newTokenData);

    const luaScript = `
      if redis.call('EXISTS', KEYS[1]) == 0 then
        return redis.error_reply('${LUA_SCRIPT_ERROR.OLD_TOKEN_NOT_FOUND}')
      end
      
      if redis.call('EXISTS', KEYS[2]) == 1 then
        return redis.error_reply('${LUA_SCRIPT_ERROR.TOKEN_ALREADY_EXIST}')
      end
      
      redis.call('DEL', KEYS[1])
      
      redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
      
      return 'OK'
    `;

    try {
      const result = await this.redis.eval(
        luaScript,
        2,
        oldKey,
        newKey,
        serialized,
        ttl.toString()
      );

      console.log(result);
      if (result !== "OK") {
        throw new Error(`Unexpected result from Lua script: ${result}`);
      }
    } catch (error) {
      const errorMessage = (error as Error).message;

      if (errorMessage === LUA_SCRIPT_ERROR.OLD_TOKEN_NOT_FOUND) {
        throw new TokenNotFoundError(oldToken);
      }

      if (errorMessage === LUA_SCRIPT_ERROR.TOKEN_ALREADY_EXIST) {
        throw new TokenOperationError(
          "rotate",
          new Error("New token already exists in store"),
          {
            oldToken: oldToken.substring(0, 10) + "...",
            newToken: newToken.substring(0, 10) + "...",
          }
        );
      }

      throw new TokenOperationError("rotate", error as Error, {
        oldToken: oldToken.substring(0, 10) + "...",
        newToken: newToken.substring(0, 10) + "...",
      });
    }
  }

  async save(token: string, data: TokenData, ttl: number): Promise<void> {
    const key = this.getTokenKey(token);
    await this.redis.setex(key, ttl, JSON.stringify(data));
  }

  async get(token: string): Promise<TokenData | null> {
    const key = this.getTokenKey(token);
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data);
    } catch (parseError) {
      throw new TokenOperationError(
        "get",
        new Error("Failed to parse token data from Redis"),
        { parseError: (parseError as Error).message }
      );
    }
  }

  async delete(token: string): Promise<void> {
    const key = this.getTokenKey(token);
    await this.redis.del(key);
  }

  async health(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }
  private getTokenKey(token: string): string {
    return `${this.keyPrefix}:${token}`;
  }
}
