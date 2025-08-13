// ===================== ABSTRACT BASE ADAPTER =====================

import {
  ITokenStoreAdapter,
  TokenData,
  TokenOperationError,
  TokenSaveRequest,
} from "../core/interfaces";

/**
 * Abstract base adapter with common utilities
 *
 * Provides basic functionality for all token storage adapters,
 * including error handling, validation, and key generation.
 */
export abstract class BaseStoreAdapter implements ITokenStoreAdapter {
  /**
   * Saves token with specified data and TTL
   */
  abstract saveToken(request: TokenSaveRequest): Promise<void>;

  /**
   * Gets token data by token
   */
  abstract getTokenData(token: string): Promise<TokenData | null>;

  /**
   * Deletes specific token
   */
  abstract deleteToken(token: string): Promise<void>;

  /**
   * Checks adapter health
   */
  abstract isHealthy(): Promise<boolean>;

  /**
   * Utility method for error handling
   */
  protected handleError(
    operation: string,
    error: unknown,
    context?: any
  ): never {
    if (error instanceof Error) {
      throw new TokenOperationError(operation, error, context);
    }

    throw new TokenOperationError(operation, new Error(String(error)), context);
  }

  /**
   * Validates token (basic check)
   */
  protected validateToken(token: string): void {
    if (typeof token !== "string" || token === "") {
      throw new Error("Invalid token format");
    }
  }

  /**
   * Creates key for token storage (can be overridden)
   */
  protected getTokenKey(token: string): string {
    return `token:${token}`;
  }
}
