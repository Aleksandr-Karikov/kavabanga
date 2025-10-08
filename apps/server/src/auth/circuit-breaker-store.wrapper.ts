import { ITokenStore, TokenData } from "@kavabanga/token-registry-core";
import { Logger } from "@nestjs/common";
import { CircuitBreakerManager } from "src/shared/circuit-breaker/circuit-breaker.manager";

export class CircuitBreakerStoreWrapper implements ITokenStore {
  private readonly logger = new Logger(CircuitBreakerStoreWrapper.name);

  constructor(
    private readonly underlyingStore: ITokenStore,
    private readonly circuitBreakerManager: CircuitBreakerManager
  ) {}

  async save(token: string, data: TokenData, ttl: number): Promise<void> {
    return await this.circuitBreakerManager.fire(
      "token-store-save",
      async (t: string, d: TokenData, timeToLive: number) => {
        return await this.underlyingStore.save(t, d, timeToLive);
      },
      [token, data, ttl],
      {
        timeout: 3000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        volumeThreshold: 3,
        fallbackFn: (error, t: string, d: TokenData) => {
          const errorMessage = error.message || String(error);

          this.logger.warn(
            `Token save fallback: ${errorMessage}. User: ${d.sub}. Token will not be persisted.`
          );

          return Promise.resolve(undefined);
        },
      }
    );
  }

  async get(token: string): Promise<TokenData | null> {
    return await this.circuitBreakerManager.fire(
      "token-store-get",
      async (t: string) => {
        return await this.underlyingStore.get(t);
      },
      [token],
      {
        timeout: 2000,
        errorThresholdPercentage: 40,
        resetTimeout: 20000,
        volumeThreshold: 3,
        fallbackFn: (error) => {
          const errorMessage = error.message || String(error);
          const tokenPrefix = token.substring(0, 8);

          this.logger.warn(
            `Token get fallback: ${errorMessage}. Returning null for token ${tokenPrefix}...`
          );

          return Promise.resolve(null);
        },
      }
    );
  }

  async delete(token: string): Promise<void> {
    return await this.circuitBreakerManager.fire(
      "token-store-delete",
      async (t: string) => {
        return await this.underlyingStore.delete(t);
      },
      [token],
      {
        timeout: 2000,
        errorThresholdPercentage: 60,
        resetTimeout: 20000,
        volumeThreshold: 3,
        fallbackFn: (error) => {
          const errorMessage = error.message || String(error);
          const tokenPrefix = token.substring(0, 8);

          this.logger.warn(
            `Token delete fallback: ${errorMessage}. Token ${tokenPrefix}... may remain in store.`
          );

          return Promise.resolve(undefined);
        },
      }
    );
    // УБРАТЬ внешний try/catch
  }

  async health(): Promise<boolean> {
    return await this.circuitBreakerManager.fire(
      "token-store-health",
      async () => {
        return await this.underlyingStore.health();
      },
      [],
      {
        timeout: 1000,
        errorThresholdPercentage: 30,
        resetTimeout: 10000,
        volumeThreshold: 2,
        fallbackFn: (error) => {
          const errorMessage = error.message || String(error);
          this.logger.debug(`Health check fallback: ${errorMessage}`);
          return Promise.resolve(false);
        },
      }
    );
  }
}
