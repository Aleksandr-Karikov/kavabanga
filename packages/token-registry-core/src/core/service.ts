import {
  ITokenStore,
  ITokenValidator,
  TokenEventHandler,
  TokenData,
  TokenRegistryConfig,
  TokenOperationError,
  TokenNotFoundError,
  TokenTimeoutError,
  TokenExpiredError,
  ITokenMeta,
  TokenRegistryError,
  DEFAULT_CONFIG,
  TokenOperation,
  TokenValidationError,
} from "./interfaces";

export class TokenRegistryService<T extends ITokenMeta = ITokenMeta> {
  private eventHandlers: TokenEventHandler<T>[] = [];
  private isShuttingDown = false;

  constructor(
    private readonly store: ITokenStore,
    private readonly config: TokenRegistryConfig,
    private readonly validator: ITokenValidator<T>
  ) {}

  registerEventHandler(handler: TokenEventHandler<T>): void {
    this.eventHandlers.push(handler);
  }

  unregisterEventHandler(handler: TokenEventHandler<T>): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index !== -1) {
      this.eventHandlers.splice(index, 1);
    }
  }

  async saveToken(
    token: string,
    data: Omit<TokenData<T>, "expiresAt" | "issuedAt"> & {
      issuedAt?: TokenData["issuedAt"];
      expiresAt?: TokenData["expiresAt"];
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
    const now = Date.now();

    const completeTokenData: TokenData<T> = {
      ...data,
      expiresAt: data.expiresAt ?? now + effectiveTtl * 1000,
      issuedAt: data.issuedAt ?? now,
    };

    return this.executeOperation(
      "save",
      async () => {
        if (this.config.enableValidation) {
          await this.validator.validate(token, completeTokenData, effectiveTtl);
        }

        await this.store.save(token, completeTokenData, effectiveTtl);

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
        const data = await this.store.get(token);
        if (!data) {
          throw new TokenNotFoundError(token);
        }

        await this.store.delete(token);

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

  async rotateToken(
    oldToken: string,
    newToken: string,
    newTokenData: Omit<TokenData<T>, "expiresAt" | "issuedAt"> & {
      issuedAt?: TokenData["issuedAt"];
      expiresAt?: TokenData["expiresAt"];
    },
    ttl?: number
  ): Promise<void> {
    if (this.isShuttingDown) {
      throw new TokenOperationError(
        "rotate",
        new Error("Service is shutting down")
      );
    }

    return this.executeOperation(
      "rotate",
      async () => {
        if (
          !oldToken ||
          typeof oldToken !== "string" ||
          oldToken.trim().length === 0
        ) {
          throw new TokenValidationError(
            "Old token must be a non-empty string",
            { operation: "rotate" }
          );
        }

        if (
          !newToken ||
          typeof newToken !== "string" ||
          newToken.trim().length === 0
        ) {
          throw new TokenValidationError(
            "New token must be a non-empty string",
            { operation: "rotate" }
          );
        }

        if (oldToken === newToken) {
          throw new TokenValidationError(
            "New token must be different from old token",
            { operation: "rotate" }
          );
        }

        const oldData = await this.store.get(oldToken);

        if (!oldData) {
          throw new TokenNotFoundError(oldToken);
        }

        if (oldData.expiresAt < Date.now()) {
          throw new TokenExpiredError(oldToken, oldData.expiresAt);
        }

        const effectiveTtl = ttl ?? this.config.defaultTtl;
        const now = Date.now();

        const completeTokenData: TokenData<T> = {
          ...newTokenData,
          expiresAt: newTokenData.expiresAt ?? now + effectiveTtl * 1000,
          issuedAt: newTokenData.issuedAt ?? now,
        };

        if (this.config.enableValidation) {
          await this.validator.validate(
            newToken,
            completeTokenData,
            effectiveTtl
          );
        }

        await this.store.rotate(
          oldToken,
          newToken,
          completeTokenData,
          effectiveTtl
        );

        if (this.config.enableEvents) {
          await Promise.allSettled([
            this.notifyEventHandlers(
              "onTokenRevoked",
              oldToken,
              oldData as TokenData<T>
            ),
            this.notifyEventHandlers(
              "onTokenCreated",
              newToken,
              completeTokenData as TokenData<T>
            ),
          ]);
        }
      },
      {
        oldToken: oldToken.substring(0, 10) + "...",
        newToken: newToken.substring(0, 10) + "...",
      }
    );
  }

  async getHealthStatus(): Promise<boolean> {
    try {
      return await this.executeOperation("health", () => this.store.health());
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  getStore(): ITokenStore {
    return this.store;
  }

  getConfig(): TokenRegistryConfig {
    return this.config;
  }

  getRegisteredEventHandlers(): readonly TokenEventHandler<T>[] {
    return [...this.eventHandlers];
  }

  // ===================== PRIVATE METHODS =====================

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
      if (error instanceof TokenRegistryError) {
        throw error;
      }

      throw new TokenOperationError(operation, error as Error, context);
    }
  }

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

  private async notifyEventHandlers(
    event: keyof TokenEventHandler<T>,
    token: string,
    data: TokenData<T>
  ): Promise<void> {
    const promises = this.eventHandlers.map((handler) => {
      const handlerFn = handler[event];
      if (typeof handlerFn === "function") {
        return handlerFn.call(handler, token, data).catch((error) => {
          console.error(`Error in event handler during '${event}':`, error);
        });
      }
      return Promise.resolve();
    });

    await Promise.all(promises);
  }
}

export class TokenRegistryServiceFactory {
  static create<T extends ITokenMeta = ITokenMeta>(
    store: ITokenStore,
    config: TokenRegistryConfig,
    validator: ITokenValidator<T>,
    eventHandlers: TokenEventHandler<T>[] = []
  ): TokenRegistryService<T> {
    const service = new TokenRegistryService(store, config, validator);
    eventHandlers.forEach((handler) => service.registerEventHandler(handler));
    return service;
  }

  static createDefault<T extends ITokenMeta = ITokenMeta>(
    store: ITokenStore,
    validator: ITokenValidator<T>
  ): TokenRegistryService<T> {
    return new TokenRegistryService(store, DEFAULT_CONFIG, validator);
  }
}
