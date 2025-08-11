// ===================== CORE EXPORTS =====================

// Interfaces
export * from "./core/interfaces";

// Service
export * from "./core/service";

// Validators
export * from "./core/validators";

// Module
export * from "./module";

// ===================== RE-EXPORTS FOR CONVENIENCE =====================

// Main classes that users will most commonly use
export {
  TokenRegistryService,
  TokenRegistryServiceFactory,
} from "./core/service";

export {
  TokenRegistryModule,
  createBasicTokenRegistryModule,
  createTestTokenRegistryModule,
} from "./module";

export {
  DefaultTokenValidator,
  StrictTokenValidator,
  NoOpValidator,
} from "./core/validators";

// Main interfaces
export type {
  ITokenStoreAdapter,
  ITokenPlugin,
  ITokenValidator,
  ITokenMeta,
  TokenData,
  TokenSaveRequest,
  TokenRegistryConfig,
  TokenRegistryModuleOptions,
  TokenRegistryAsyncOptions,
} from "./core/interfaces";

// Error classes
export {
  TokenRegistryError,
  TokenValidationError,
  TokenNotFoundError,
  TokenOperationError,
  TokenConfigurationError,
  TokenTimeoutError,
} from "./core/interfaces";

// Extension base class
export { TokenRegistryExtension } from "./core/interfaces";

// Configuration
export { DEFAULT_CONFIG } from "./core/interfaces";

// Tokens for dependency injection
export {
  TOKEN_REGISTRY_OPTIONS,
  TOKEN_REGISTRY_CONFIG,
  TOKEN_STORE_ADAPTER,
  TOKEN_VALIDATOR,
  TOKEN_PLUGINS,
} from "./module";
// core/service.ts
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
  PluginHook,
  PluginExecutionContext,
  ITokenMeta,
  TokenRegistryError,
} from "./interfaces";

export class TokenRegistryService<T extends ITokenMeta = ITokenMeta> {
  private plugins: ITokenPlugin<T>[] = [];
  private isShuttingDown = false;

  constructor(
    private readonly adapter: ITokenStoreAdapter,
    private readonly config: TokenRegistryConfig,
    private readonly validator: ITokenValidator<T>
  ) {}

  registerPlugin(plugin: ITokenPlugin<T>): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new TokenConfigurationError(
        `Plugin with name '${plugin.name}' already registered`
      );
    }

    this.plugins.push(plugin);
    this.plugins.sort((a, b) => a.priority - b.priority);
  }

  unregisterPlugin(pluginName: string): void {
    const index = this.plugins.findIndex((p) => p.name === pluginName);
    if (index !== -1) {
      this.plugins.splice(index, 1);
    }
  }

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
        if (this.config.enableValidation) {
          await this.validator.validate(request);
        }

        await this.executePlugins("preSave", { request, hook: "preSave" });

        // Приводим к базовому типу для адаптера
        const baseRequest: TokenSaveRequest = {
          token: request.token,
          data: request.data as TokenData<ITokenMeta>,
          ttl: request.ttl,
        };
        await this.adapter.saveToken(baseRequest);

        await this.executePlugins("postSave", { request, hook: "postSave" });
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
      "getTokenData",
      async () => {
        await this.executePlugins("preGet", { token, hook: "preGet" });

        const data = await this.adapter.getTokenData(token);

        // Приводим к generic типу с проверкой
        const typedData = data ? this.castTokenData<T>(data) : null;

        await this.executePlugins("postGet", {
          token,
          data: typedData,
          hook: "postGet",
        });

        return typedData;
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
      "revokeToken",
      async () => {
        const data = await this.getTokenData(token);
        if (!data) {
          throw new TokenNotFoundError(token);
        }

        await this.executePlugins("preRevoke", {
          token,
          data,
          hook: "preRevoke",
        });

        await this.adapter.deleteToken(token);

        await this.executePlugins("postRevoke", {
          token,
          data,
          hook: "postRevoke",
        });
      },
      { token }
    );
  }

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
        if (this.config.enableValidation) {
          await Promise.all(
            requests.map((req) => this.validator.validate(req))
          );
        }

        if (this.config.enablePlugins) {
          await Promise.all(
            requests.map((request) =>
              this.executePlugins("preSave", { request, hook: "preSave" })
            )
          );
        }

        // Конвертируем запросы к базовому типу
        const baseRequests = requests.map((req) => ({
          token: req.token,
          data: req.data as TokenData<ITokenMeta>,
          ttl: req.ttl,
        }));

        await this.adapter.saveBatchTokens(baseRequests);

        if (this.config.enablePlugins) {
          await Promise.all(
            requests.map((request) =>
              this.executePlugins("postSave", { request, hook: "postSave" })
            )
          );
        }
      },
      { batchSize: requests.length }
    );
  }

  async getHealthStatus(): Promise<boolean> {
    try {
      return await this.executeOperation("isHealthy", () =>
        this.adapter.isHealthy()
      );
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

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
      if (this.config.enablePlugins) {
        // Вызываем onError для всех плагинов
        await Promise.all(
          this.plugins.map((plugin) => {
            if (plugin.onError) {
              return plugin.onError(operation, error as Error, context);
            }
            return Promise.resolve();
          })
        );
      }

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
          await pluginFn.call(plugin, fullContext);
        } catch (error) {
          console.error(
            `Error in plugin '${plugin.name}' during '${hook}':`,
            error
          );

          if (plugin.onError) {
            await plugin.onError(hook, error as Error, fullContext);
          }
        }
      }
    }
  }

  private castTokenData<T extends ITokenMeta>(
    data: TokenData<ITokenMeta>
  ): TokenData<T> {
    // Здесь можно добавить дополнительную проверку структуры
    // при необходимости
    return data as unknown as TokenData<T>;
  }
}

export class TokenRegistryServiceFactory {
  static create<T extends ITokenMeta = ITokenMeta>(
    adapter: ITokenStoreAdapter,
    config: TokenRegistryConfig,
    validator: ITokenValidator<T>,
    plugins: ITokenPlugin<T>[] = []
  ): TokenRegistryService<T> {
    const service = new TokenRegistryService(adapter, config, validator);

    plugins.forEach((plugin) => service.registerPlugin(plugin));

    return service;
  }
}

// Добавляем недостающий класс ошибки
class TokenConfigurationError extends TokenRegistryError {
  readonly code = "CONFIGURATION_ERROR";

  constructor(message: string, context?: Record<string, unknown>) {
    super(`Configuration error: ${message}`, context);
  }
}
