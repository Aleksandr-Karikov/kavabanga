import {
  TokenData,
  ITokenStore,
  TokenOperationError,
  TokenNotFoundError,
} from "../core/interfaces";

// ===================== SIMPLIFIED IN-MEMORY STORE =====================

/**
 * In-Memory store for tokens
 * Simple and fast store for development, testing and small applications.
 * Automatically deletes tokens after TTL expiration using Node.js timers.
 */
export class InMemoryStore implements ITokenStore {
  private readonly tokens = new Map<string, TokenData>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  // Cap at maximum safe timeout value (24.8 days)
  private readonly MAX_TIME_TO_STORE = 2147483647;

  async save(token: string, data: TokenData, ttl: number): Promise<void> {
    // Clear existing timer if any
    this.clearExistingTimer(token);

    // Save data
    this.tokens.set(token, data);

    // Set timer for automatic deletion
    const timeoutMs = Math.min(ttl * 1000, this.MAX_TIME_TO_STORE);
    const timer = setTimeout(() => {
      this.tokens.delete(token);
      this.timers.delete(token);
    }, timeoutMs);

    this.timers.set(token, timer);
  }

  async get(token: string): Promise<TokenData | null> {
    return this.tokens.get(token) || null;
  }

  async delete(token: string): Promise<void> {
    this.clearExistingTimer(token);
    this.tokens.delete(token);
  }
  async rotate(
    oldToken: string,
    newToken: string,
    newTokenData: TokenData,
    ttl: number
  ): Promise<void> {
    if (!this.tokens.has(oldToken)) {
      throw new TokenNotFoundError(oldToken);
    }

    if (this.tokens.has(newToken)) {
      throw new TokenOperationError(
        "rotate",
        new Error("New token already exists in store"),
        {
          newToken: newToken.substring(0, 8) + "...",
        }
      );
    }

    const timeoutMs = Math.min(ttl * 1000, this.MAX_TIME_TO_STORE);

    let newTimer: NodeJS.Timeout;
    try {
      newTimer = setTimeout(() => {
        this.tokens.delete(newToken);
        this.timers.delete(newToken);
      }, timeoutMs);
    } catch (error) {
      throw new TokenOperationError("rotate", error as Error, {
        oldToken: oldToken.substring(0, 8) + "...",
        newToken: newToken.substring(0, 8) + "...",
        step: "timer_creation",
      });
    }

    const oldTokenData = this.tokens.get(oldToken)!;
    const oldTimer = this.timers.get(oldToken);

    try {
      if (oldTimer) {
        clearTimeout(oldTimer);
      }

      this.tokens.delete(oldToken);
      this.timers.delete(oldToken);

      this.tokens.set(newToken, newTokenData);
      this.timers.set(newToken, newTimer);
    } catch (error) {
      // Rollback
      clearTimeout(newTimer);
      this.tokens.delete(newToken);
      this.timers.delete(newToken);

      if (!this.tokens.has(oldToken)) {
        this.tokens.set(oldToken, oldTokenData);

        const remainingMs = oldTokenData.expiresAt - Date.now();
        if (remainingMs > 0) {
          try {
            const restoredTimer = setTimeout(
              () => {
                this.tokens.delete(oldToken);
                this.timers.delete(oldToken);
              },
              Math.min(remainingMs, this.MAX_TIME_TO_STORE)
            );

            this.timers.set(oldToken, restoredTimer);
          } catch (timerError) {
            console.error(
              "Failed to restore timer during rollback:",
              timerError
            );
          }
        }
      }

      throw new TokenOperationError("rotate", error as Error, {
        oldToken: oldToken.substring(0, 8) + "...",
        newToken: newToken.substring(0, 8) + "...",
        step: "atomic_operation",
        rollbackCompleted: this.tokens.has(oldToken),
      });
    }
  }

  async health(): Promise<boolean> {
    // In-memory store is always healthy
    return true;
  }

  // ===================== UTILITY METHODS =====================

  /**
   * Gets count of active tokens (for testing/monitoring)
   */
  getActiveTokenCount(): number {
    return this.tokens.size;
  }

  /**
   * Gets list of all active tokens (for debugging)
   */
  getActiveTokens(): string[] {
    return Array.from(this.tokens.keys());
  }

  /**
   * Clears all tokens (for testing)
   */
  clear(): void {
    // Clear all timers
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.tokens.clear();
    this.timers.clear();
  }

  /**
   * Forcibly expires token (for testing)
   */
  expireToken(token: string): boolean {
    if (this.tokens.has(token)) {
      this.clearExistingTimer(token);
      this.tokens.delete(token);
      return true;
    }
    return false;
  }

  // ===================== PRIVATE METHODS =====================

  private clearExistingTimer(token: string): void {
    const existingTimer = this.timers.get(token);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(token);
    }
  }
}

// ===================== FACTORY FUNCTIONS =====================

/**
 * Creates in-memory store for development
 */
export function createMemoryStore(): InMemoryStore {
  return new InMemoryStore();
}

/**
 * Creates in-memory store for testing with additional utilities
 */
export function createTestMemoryStore(): InMemoryStore {
  const store = new InMemoryStore();

  // Add additional methods for tests
  (store as any).getAllTokensWithData = () => {
    const entries = Array.from((store as any).tokens.entries()) as Array<
      [string, any]
    >;
    return entries.map(([token, data]) => ({
      token,
      data,
      hasTimer: (store as any).timers.has(token),
    }));
  };

  return store;
}
