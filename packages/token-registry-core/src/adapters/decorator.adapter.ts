// ===================== DECORATOR PATTERN BASE =====================

import {
  ITokenStoreAdapter,
  TokenData,
  TokenSaveRequest,
} from "../core/interfaces";

/**
 * Base class for adapter decorators
 *
 * Implements Decorator pattern for adapter capability composition.
 * Allows wrapping any adapter and adding additional functionality
 * without changing the interface.
 */
export abstract class StoreAdapterDecorator implements ITokenStoreAdapter {
  constructor(protected readonly wrapped: ITokenStoreAdapter) {
    if (!wrapped) {
      throw new Error("Wrapped adapter is required");
    }
  }

  async saveToken(request: TokenSaveRequest): Promise<void> {
    return this.wrapped.saveToken(request);
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    return this.wrapped.getTokenData(token);
  }

  async deleteToken(token: string): Promise<void> {
    return this.wrapped.deleteToken(token);
  }

  async isHealthy(): Promise<boolean> {
    return this.wrapped.isHealthy();
  }

  /**
   * Provides access to wrapped adapter
   */
  protected getWrapped(): ITokenStoreAdapter {
    return this.wrapped;
  }

  /**
   * Gets the deepest adapter in decorator chain
   */
  protected getInnerMost(): ITokenStoreAdapter {
    let current: ITokenStoreAdapter = this.wrapped;

    while (current instanceof StoreAdapterDecorator) {
      current = current.getWrapped();
    }

    return current;
  }
}
