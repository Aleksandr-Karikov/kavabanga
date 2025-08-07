import { RefreshTokenData } from "src/auth/refresh-token/refresh-token.types";

export interface ITokenRepository {
  getTokenData(token: string): Promise<RefreshTokenData | null>;
  saveToken(
    token: string,
    data: RefreshTokenData,
    userId: string
  ): Promise<number>;
  saveBatchTokens(
    userTokens: Array<{ token: string; data: RefreshTokenData }>,
    userId: string
  ): Promise<number>;
  markTokenUsed(token: string, userId: string): Promise<number>;
  deleteToken(token: string, userId: string): Promise<number>;
  revokeAllTokens(userId: string): Promise<number>;
  revokeDeviceTokens(userId: string, deviceId: string): Promise<number>;
  getUserTokenStatsOptimized(
    userId: string,
    maxBatchSize: number,
    statsCacheTtl: number
  ): Promise<[number, number, string[]]>;
  cleanupUserExpiredTokens(userId: string): Promise<number>;
  scanUserTokenKeys(
    cursor?: string,
    batchSize?: number
  ): Promise<[string, string[]]>;
  deleteKey(key: string): Promise<number>;
  healthCheck(): Promise<boolean>;
  invalidateStatsCache(userId: string): Promise<number>;
}
