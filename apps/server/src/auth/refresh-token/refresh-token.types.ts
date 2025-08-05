import { Redis } from "ioredis";

// ===================== ERROR CLASSES =====================

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

// ===================== INTERFACES =====================

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

// ===================== REDIS EXTENDED TYPES =====================

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
