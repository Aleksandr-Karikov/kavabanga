import {
  ITokenStoreAdapter,
  ITokenPlugin,
  ITokenValidator,
  TokenSaveRequest,
  TokenData,
  TokenRegistryConfig,
  TokenOperationError,
  TokenNotFoundError,
  TokenTimeoutError,
  TokenConfigurationError,
  PluginHook,
  PluginExecutionContext,
  ITokenMeta,
  TokenRegistryError,
  DEFAULT_CONFIG,
} from "./interfaces";

/**
 * Main service for token management
 */
export class TokenRegistryService<T extends ITokenMeta = ITokenMeta> {
  private plugins: ITokenPlugin<T>[] = [];
  private isShuttingDown = false;

  constructor(
    private readonly adapter: ITokenStoreAdapter,
    private readonly config: TokenRegistryConfig,
    private readonly validator: ITokenValidator<T>
  ) {}

  /**
   * Registers plugin in service
   */
  registerPlugin(plugin: ITokenPlugin<T>): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new TokenConfigurationError(
        `Plugin with name '${plugin.name}' already registered`
      );
    }

    this.plugins.push(plugin);
    this.plugins.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Unregisters plugin
   */
  unregisterPlugin(pluginName: string): void {
    const index = this.plugins.findIndex((p) => p.name === pluginName);
    if (index !== -1) {
      this.plugins.splice(index, 1);
    }
  }

  /**
   * Saves token with specified data
   */
  async saveToken(
    token: string,
    data: TokenData<T>,
    ttl?: number
  ): Promise<void> {
    if (this.isShuttingDown) {
      throw new TokenOperationError(
        "saveToken",
        new Error("Service is shutting down")
      );
    }

    const effectiveTtl = ttl ?? this.config.defaultTtl;
    const request: TokenSaveRequest<T> = { token, data, ttl: effectiveTtl };

    return this.executeOperation(
      "saveToken",
      async () => {
        // Request validation
        if (this.config.enableValidation) {
          await this.validator.validate(request);
        }

        // Execute hooks before saving
        await this.executePlugins("preSave", { request });

        // Cast to base type for adapter
        const baseRequest: TokenSaveRequest = {
          token: request.token,
          data: request.data as TokenData<ITokenMeta>,
          ttl: request.ttl,
        };

        // Save through adapter
        await this.adapter.saveToken(baseRequest);

        // Execute hooks after saving
        await this.executePlugins("postSave", { request });
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
      "getTokenData",
      async () => {
        // Execute hooks before getting
        await this.executePlugins("preGet", { token });

        // Get data through adapter
        const data = await this.adapter.getTokenData(token);

        // Cast to generic type with validation
        const typedData = data ? this.castTokenData<T>(data) : null;

        // Execute hooks after getting
        await this.executePlugins("postGet", {
          token,
          data: typedData || undefined,
        });

        return typedData;
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
      "revokeToken",
      async () => {
        // First get token data for hooks
        const data = await this.getTokenData(token);
        if (!data) {
          throw new TokenNotFoundError(token);
        }

        // Execute hooks before deletion
        await this.executePlugins("preRevoke", {
          token,
          data,
        });

        // Delete through adapter
        await this.adapter.deleteToken(token);

        // Execute hooks after deletion
        await this.executePlugins("postRevoke", {
          token,
          data,
        });
      },
      { token }
    );
  }

  /**
   * Batch token saving
   */
  async saveBatchTokens(requests: TokenSaveRequest<T>[]): Promise<void> {
    if (this.isShuttingDown) {
      throw new TokenOperationError(
        "saveBatchTokens",
        new Error("Service is shutting down")
      );
    }

    return this.executeOperation(
      "saveBatchTokens",
      async () => {
        // Validate all requests
        if (this.config.enableValidation) {
          await Promise.all(
            requests.map((req) => this.validator.validate(req))
          );
        }

        // Execute hooks before saving for all tokens
        if (this.config.enablePlugins) {
          await Promise.all(
            requests.map((request) =>
              this.executePlugins("preSave", { request })
            )
          );
        }

        // Convert requests to base type
        const baseRequests = requests.map((req) => ({
          token: req.token,
          data: req.data as TokenData<ITokenMeta>,
          ttl: req.ttl,
        }));

        // Batch save through adapter
        await this.adapter.saveBatchTokens(baseRequests);

        // Execute hooks after saving for all tokens
        if (this.config.enablePlugins) {
          await Promise.all(
            requests.map((request) =>
              this.executePlugins("postSave", { request })
            )
          );
        }
      },
      { batchSize: requests.length }
    );
  }

  /**
   * Checks service health status
   */
  async getHealthStatus(): Promise<boolean> {
    try {
      return await this.executeOperation("isHealthy", () =>
        this.adapter.isHealthy()
      );
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
   * Gets current store adapter (for extensions)
   */
  getStoreAdapter(): ITokenStoreAdapter {
    return this.adapter;
  }

  /**
   * Gets current configuration (for extensions)
   */
  getConfig(): TokenRegistryConfig {
    return this.config;
  }

  /**
   * Gets list of registered plugins
   */
  getRegisteredPlugins(): readonly ITokenPlugin<T>[] {
    return [...this.plugins];
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Executes operation with error handling and timeout
   */
  private async executeOperation<R>(
    operation: string,
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
      // Notify plugins about error
      if (this.config.enablePlugins) {
        await Promise.all(
          this.plugins.map((plugin) => {
            if (plugin.onError) {
              return plugin.onError(operation, error as Error, context);
            }
            return Promise.resolve();
          })
        );
      }

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
   * Executes plugin hooks
   */
  private async executePlugins(
    hook: Exclude<PluginHook, "onError">,
    context: Omit<PluginExecutionContext<T>, "hook">
  ): Promise<void> {
    if (!this.config.enablePlugins) return;

    const fullContext: PluginExecutionContext<T> = {
      ...context,
      hook,
    };

    for (const plugin of this.plugins) {
      const pluginFn = plugin[hook];
      if (typeof pluginFn === "function") {
        try {
          // Fix plugin call depending on hook
          switch (hook) {
            case "preSave":
              if (context.request && pluginFn === plugin.preSave) {
                await plugin.preSave!(context.request);
              }
              break;
            case "postSave":
              if (context.request && pluginFn === plugin.postSave) {
                await plugin.postSave!(context.request);
              }
              break;
            case "preGet":
              if (context.token && pluginFn === plugin.preGet) {
                await plugin.preGet!(context.token);
              }
              break;
            case "postGet":
              if (context.token && pluginFn === plugin.postGet) {
                await plugin.postGet!(context.token, context.data || null);
              }
              break;
            case "preRevoke":
              if (
                context.token &&
                context.data &&
                pluginFn === plugin.preRevoke
              ) {
                await plugin.preRevoke!(context.token, context.data);
              }
              break;
            case "postRevoke":
              if (
                context.token &&
                context.data &&
                pluginFn === plugin.postRevoke
              ) {
                await plugin.postRevoke!(context.token, context.data);
              }
              break;
          }
        } catch (error) {
          console.error(
            `Error in plugin '${plugin.name}' during '${hook}':`,
            error
          );

          // Notify plugin about error
          if (plugin.onError) {
            await plugin.onError(hook, error as Error, fullContext);
          }

          // In production can throw error or continue
          // Depending on plugin error handling strategy
        }
      }
    }
  }

  /**
   * Casts token data to required generic type
   */
  private castTokenData<T extends ITokenMeta>(
    data: TokenData<ITokenMeta>
  ): TokenData<T> {
    // Here additional structure validation can be added
    // if needed in the future
    return data as unknown as TokenData<T>;
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
    adapter: ITokenStoreAdapter,
    config: TokenRegistryConfig,
    validator: ITokenValidator<T>,
    plugins: ITokenPlugin<T>[] = []
  ): TokenRegistryService<T> {
    const service = new TokenRegistryService(adapter, config, validator);

    // Register all plugins
    plugins.forEach((plugin) => service.registerPlugin(plugin));

    return service;
  }

  /**
   * Creates service with default configuration
   */
  static createDefault<T extends ITokenMeta = ITokenMeta>(
    adapter: ITokenStoreAdapter,
    validator: ITokenValidator<T>
  ): TokenRegistryService<T> {
    return new TokenRegistryService(adapter, DEFAULT_CONFIG, validator);
  }
}
