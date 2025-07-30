import { Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import {
  REFRESH_TOKEN_TTL_DAYS,
  USED_TOKEN_TTL_MINUTE,
} from "src/auth/auth.constants";

interface RefreshTokenData {
  userId: string;
  deviceId: string;
  issuedAt: number;
  used: boolean;
}

@Injectable()
export class RefreshTokenStore {
  private readonly TTL_SECONDS = 60 * 60 * 24 * REFRESH_TOKEN_TTL_DAYS;
  private readonly USED_TOKEN_TTL_SECONDS = USED_TOKEN_TTL_MINUTE * 60;
  private readonly REFRESH_TOKEN_REDIS_PREFIX = "refresh";

  constructor(private readonly redis: Redis) {}

  private getKey(token: string): string {
    return `${this.REFRESH_TOKEN_REDIS_PREFIX}:${token}`;
  }

  async save(
    token: string,
    data: Omit<RefreshTokenData, "used">
  ): Promise<void> {
    const fullData: RefreshTokenData = {
      ...data,
      issuedAt: Date.now(),
      used: false,
    };
    await this.redis.set(
      this.getKey(token),
      JSON.stringify(fullData),
      "EX",
      this.TTL_SECONDS
    );
  }

  async get(token: string): Promise<RefreshTokenData | null> {
    const raw = await this.redis.get(this.getKey(token));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async markUsed(token: string): Promise<void> {
    const data = await this.get(token);
    if (!data) return;
    data.used = true;
    await this.redis.set(
      this.getKey(token),
      JSON.stringify(data),
      "EX",
      this.USED_TOKEN_TTL_SECONDS
    );
  }

  async delete(token: string): Promise<void> {
    await this.redis.del(this.getKey(token));
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    const keys = await this.redis.keys(`${this.REFRESH_TOKEN_REDIS_PREFIX}:*`);
    const pipeline = this.redis.pipeline();

    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data.userId === userId) pipeline.del(key);
    }

    await pipeline.exec();
  }

  async revokeDeviceToken(userId: string, deviceId: string): Promise<void> {
    const keys = await this.redis.keys(`${this.REFRESH_TOKEN_REDIS_PREFIX}:*`);
    const pipeline = this.redis.pipeline();

    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data.userId === userId && data.deviceId === deviceId)
        pipeline.del(key);
    }

    await pipeline.exec();
  }
}
