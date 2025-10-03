import {
  ITokenStore,
  ITokenValidator,
  TokenEventHandler,
  TokenData,
  TokenRegistryConfig,
  TokenOperationError,
  TokenNotFoundError,
  TokenTimeoutError,
  ITokenMeta,
  TokenRegistryError,
  DEFAULT_CONFIG,
  TokenOperation,
} from "./interfaces";

/**
 * Simplified token registry service
 * Focuses on core functionality: save, get, delete tokens
 */
export class TokenRegistryService<T extends ITokenMeta = ITokenMeta> {
  private eventHandlers: TokenEventHandler<T>[] = [];
  private isShuttingDown = false;

  constructor(
    private readonly store: ITokenStore,
    private readonly config: TokenRegistryConfig,
    private readonly validator: ITokenValidator<T>
  ) {}

  /**
   * Registers event handler
   */
  registerEventHandler(handler: TokenEventHandler<T>): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Unregisters event handler
   */
  unregisterEventHandler(handler: TokenEventHandler<T>): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Saves token with specified data
   */
  async saveToken(
    token: string,
    data: Omit<TokenData<T>, "expiresAt" | "issuedAt"> & {
      issuedAt?: TokenData["issuedAt"];
    },
    ttl?: number
  ): Promise<void> {
    if (this.isShuttingDown) {
      throw new TokenOperationError(
        "saveToken",
        new Error("Service is shutting down")
      );
    }

    const effectiveTtl = ttl ?? this.config.defaultTtl;
    const now = Math.floor(Date.now() / 1000);

    const completeTokenData: TokenData<T> = {
      ...data,
      expiresAt: now + effectiveTtl,
      issuedAt: data.issuedAt ?? now,
    };

    return this.executeOperation(
      "save",
      async () => {
        // Validate input
        if (this.config.enableValidation) {
          await this.validator.validate(token, completeTokenData, effectiveTtl);
        }

        // Save to store
        await this.store.save(token, completeTokenData, effectiveTtl);

        // Notify event handlers
        if (this.config.enableEvents) {
          await this.notifyEventHandlers(
            "onTokenCreated",
            token,
            completeTokenData
          );
        }
      },
      { token }
    );
  }

  /**
   * Gets token data
   */
  async getTokenData(token: string): Promise<TokenData<T> | null> {
    if (this.isShuttingDown) {
      throw new TokenOperationError(
        "getTokenData",
        new Error("Service is shutting down")
      );
    }

    return this.executeOperation(
      "get",
      async () => {
        const data = await this.store.get(token);

        if (data && this.config.enableEvents) {
          await this.notifyEventHandlers(
            "onTokenAccessed",
            token,
            data as TokenData<T>
          );
        }

        return data as TokenData<T> | null;
      },
      { token }
    );
  }

  /**
   * Revokes (deletes) token
   */
  async revokeToken(token: string): Promise<void> {
    if (this.isShuttingDown) {
      throw new TokenOperationError(
        "revokeToken",
        new Error("Service is shutting down")
      );
    }

    return this.executeOperation(
      "delete",
      async () => {
        // Get token data for event handlers
        const data = await this.store.get(token);
        if (!data) {
          throw new TokenNotFoundError(token);
        }

        // Delete from store
        await this.store.delete(token);

        // Notify event handlers
        if (this.config.enableEvents) {
          await this.notifyEventHandlers(
            "onTokenRevoked",
            token,
            data as TokenData<T>
          );
        }
      },
      { token }
    );
  }

  /**
   * Checks service health status
   */
  async getHealthStatus(): Promise<boolean> {
    try {
      return await this.executeOperation("health", () => this.store.health());
    } catch {
      return false;
    }
  }

  /**
   * Gracefully shuts down service
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    // Give time for current operations to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  /**
   * Gets current store
   */
  getStore(): ITokenStore {
    return this.store;
  }

  /**
   * Gets current configuration
   */
  getConfig(): TokenRegistryConfig {
    return this.config;
  }

  /**
   * Gets list of registered event handlers
   */
  getRegisteredEventHandlers(): readonly TokenEventHandler<T>[] {
    return [...this.eventHandlers];
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Executes operation with error handling and timeout
   */
  private async executeOperation<R>(
    operation: TokenOperation,
    fn: () => Promise<R>,
    context?: Record<string, unknown>
  ): Promise<R> {
    try {
      if (this.config.operationTimeout > 0) {
        return await this.withTimeout(
          fn(),
          operation,
          this.config.operationTimeout
        );
      }
      return await fn();
    } catch (error) {
      // Re-throw TokenRegistry errors as is
      if (error instanceof TokenRegistryError) {
        throw error;
      }

      // Wrap other errors
      throw new TokenOperationError(operation, error as Error, context);
    }
  }

  /**
   * Adds timeout to promise
   */
  private async withTimeout<R>(
    promise: Promise<R>,
    operation: string,
    timeout: number
  ): Promise<R> {
    return Promise.race([
      promise,
      new Promise<R>((_, reject) => {
        setTimeout(() => {
          reject(new TokenTimeoutError(operation, timeout));
        }, timeout);
      }),
    ]);
  }

  /**
   * Notifies event handlers
   */
  private async notifyEventHandlers(
    event: keyof TokenEventHandler<T>,
    token: string,
    data: TokenData<T>
  ): Promise<void> {
    const promises = this.eventHandlers.map((handler) => {
      const handlerFn = handler[event];
      if (typeof handlerFn === "function") {
        return handlerFn(token, data).catch((error) => {
          console.error(`Error in event handler during '${event}':`, error);
        });
      }
      return Promise.resolve();
    });

    await Promise.all(promises);
  }
}

/**
 * Factory for creating TokenRegistryService instances
 */
export class TokenRegistryServiceFactory {
  /**
   * Creates new service instance with specified parameters
   */
  static create<T extends ITokenMeta = ITokenMeta>(
    store: ITokenStore,
    config: TokenRegistryConfig,
    validator: ITokenValidator<T>,
    eventHandlers: TokenEventHandler<T>[] = []
  ): TokenRegistryService<T> {
    const service = new TokenRegistryService(store, config, validator);

    // Register all event handlers
    eventHandlers.forEach((handler) => service.registerEventHandler(handler));

    return service;
  }

  /**
   * Creates service with default configuration
   */
  static createDefault<T extends ITokenMeta = ITokenMeta>(
    store: ITokenStore,
    validator: ITokenValidator<T>
  ): TokenRegistryService<T> {
    return new TokenRegistryService(store, DEFAULT_CONFIG, validator);
  }
}
