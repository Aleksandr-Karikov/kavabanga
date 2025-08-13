import { TokenSaveRequest, TokenData } from "../core/interfaces";
import { BaseStoreAdapter } from "./abstract.adapter";

// ===================== IN-MEMORY ADAPTER =====================

/**
 * In-Memory adapter for storing tokens in memory
 *
 * Simple and fast adapter for development, testing and small applications.
 * Automatically deletes tokens after TTL expiration using Node.js timers.
 */
export class InMemoryStoreAdapter extends BaseStoreAdapter {
  private readonly tokens = new Map<string, TokenData>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  async saveToken(request: TokenSaveRequest): Promise<void> {
    try {
      const { token, data, ttl } = request;
      this.validateToken(token);

      // Clear existing timer if any
      this.clearExistingTimer(token);

      // Save data
      this.tokens.set(token, data);

      // Set timer for automatic deletion
      // Cap at maximum safe timeout value (24.8 days)
      const timeoutMs = Math.min(ttl * 1000, 2147483647);
      const timer = setTimeout(() => {
        this.tokens.delete(token);
        this.timers.delete(token);
      }, timeoutMs);

      this.timers.set(token, timer);
    } catch (error) {
      this.handleError("saveToken", error, { token: request.token });
    }
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    try {
      this.validateToken(token);
      return this.tokens.get(token) || null;
    } catch (error) {
      this.handleError("getTokenData", error, { token });
    }
  }

  async deleteToken(token: string): Promise<void> {
    try {
      this.validateToken(token);

      this.clearExistingTimer(token);
      this.tokens.delete(token);
    } catch (error) {
      this.handleError("deleteToken", error, { token });
    }
  }

  async isHealthy(): Promise<boolean> {
    // In-memory adapter is always healthy
    return true;
  }

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
   * Gets timer information (for debugging)
   */
  getTimersInfo(): Array<{ token: string; hasTimer: boolean }> {
    return Array.from(this.tokens.keys()).map((token) => ({
      token,
      hasTimer: this.timers.has(token),
    }));
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

  /**
   * Gets adapter statistics
   */
  getStats(): {
    totalTokens: number;
    activeTimers: number;
    memoryUsage: string;
  } {
    const totalTokens = this.tokens.size;
    const activeTimers = this.timers.size;

    // Approximate memory usage estimate
    let memoryBytes = 0;
    for (const [token, data] of this.tokens.entries()) {
      memoryBytes += token.length * 2; // UTF-16
      memoryBytes += JSON.stringify(data).length * 2;
    }

    return {
      totalTokens,
      activeTimers,
      memoryUsage: this.formatBytes(memoryBytes),
    };
  }

  // ===================== PRIVATE METHODS =====================

  private clearExistingTimer(token: string): void {
    const existingTimer = this.timers.get(token);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(token);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}

// ===================== FACTORY FUNCTIONS =====================

/**
 * Creates in-memory adapter for development
 */
export function createDevelopmentMemoryAdapter(): InMemoryStoreAdapter {
  return new InMemoryStoreAdapter();
}

/**
 * Creates in-memory adapter for testing with additional utilities
 */
export function createTestMemoryAdapter(): InMemoryStoreAdapter {
  const adapter = new InMemoryStoreAdapter();

  // Add additional methods for tests
  (adapter as any).getAllTokensWithData = () => {
    const entries = Array.from((adapter as any).tokens.entries()) as Array<
      [string, any]
    >;
    return entries.map(([token, data]) => ({
      token,
      data,
      hasTimer: (adapter as any).timers.has(token),
    }));
  };

  return adapter;
}
