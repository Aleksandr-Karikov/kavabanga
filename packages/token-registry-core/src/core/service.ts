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
 * Основной сервис для управления токенами
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
   * Регистрирует плагин в сервисе
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
   * Отменяет регистрацию плагина
   */
  unregisterPlugin(pluginName: string): void {
    const index = this.plugins.findIndex((p) => p.name === pluginName);
    if (index !== -1) {
      this.plugins.splice(index, 1);
    }
  }

  /**
   * Сохраняет токен с указанными данными
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
        // Валидация запроса
        if (this.config.enableValidation) {
          await this.validator.validate(request);
        }

        // Выполнение хуков перед сохранением
        await this.executePlugins("preSave", { request });

        // Приводим к базовому типу для адаптера
        const baseRequest: TokenSaveRequest = {
          token: request.token,
          data: request.data as TokenData<ITokenMeta>,
          ttl: request.ttl,
        };

        // Сохранение через адаптер
        await this.adapter.saveToken(baseRequest);

        // Выполнение хуков после сохранения
        await this.executePlugins("postSave", { request });
      },
      { token }
    );
  }

  /**
   * Получает данные токена
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
        // Выполнение хуков перед получением
        await this.executePlugins("preGet", { token });

        // Получение данных через адаптер
        const data = await this.adapter.getTokenData(token);

        // Приводим к generic типу с проверкой
        const typedData = data ? this.castTokenData<T>(data) : null;

        // Выполнение хуков после получения
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
   * Отзывает (удаляет) токен
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
        // Сначала получаем данные токена для хуков
        const data = await this.getTokenData(token);
        if (!data) {
          throw new TokenNotFoundError(token);
        }

        // Выполнение хуков перед удалением
        await this.executePlugins("preRevoke", {
          token,
          data,
        });

        // Удаление через адаптер
        await this.adapter.deleteToken(token);

        // Выполнение хуков после удаления
        await this.executePlugins("postRevoke", {
          token,
          data,
        });
      },
      { token }
    );
  }

  /**
   * Пакетное сохранение токенов
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
        // Валидация всех запросов
        if (this.config.enableValidation) {
          await Promise.all(
            requests.map((req) => this.validator.validate(req))
          );
        }

        // Выполнение хуков перед сохранением для всех токенов
        if (this.config.enablePlugins) {
          await Promise.all(
            requests.map((request) =>
              this.executePlugins("preSave", { request })
            )
          );
        }

        // Конвертируем запросы к базовому типу
        const baseRequests = requests.map((req) => ({
          token: req.token,
          data: req.data as TokenData<ITokenMeta>,
          ttl: req.ttl,
        }));

        // Пакетное сохранение через адаптер
        await this.adapter.saveBatchTokens(baseRequests);

        // Выполнение хуков после сохранения для всех токенов
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
   * Проверяет состояние здоровья сервиса
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
   * Корректно завершает работу сервиса
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    // Даем время завершиться текущим операциям
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  /**
   * Получает текущий адаптер хранилища (для расширений)
   */
  getStoreAdapter(): ITokenStoreAdapter {
    return this.adapter;
  }

  /**
   * Получает текущую конфигурацию (для расширений)
   */
  getConfig(): TokenRegistryConfig {
    return this.config;
  }

  /**
   * Получает список зарегистрированных плагинов
   */
  getRegisteredPlugins(): readonly ITokenPlugin<T>[] {
    return [...this.plugins];
  }

  // ===================== PRIVATE METHODS =====================

  /**
   * Выполняет операцию с обработкой ошибок и таймаутом
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
      // Уведомляем плагины об ошибке
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

      // Перебрасываем ошибки TokenRegistry как есть
      if (error instanceof TokenRegistryError) {
        throw error;
      }

      // Оборачиваем другие ошибки
      throw new TokenOperationError(operation, error as Error, context);
    }
  }

  /**
   * Добавляет таймаут к промису
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
   * Выполняет хуки плагинов
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
          // Исправляем вызов плагина в зависимости от хука
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

          // Уведомляем плагин об ошибке
          if (plugin.onError) {
            await plugin.onError(hook, error as Error, fullContext);
          }

          // В production можно выбросить ошибку или продолжить
          // В зависимости от стратегии обработки ошибок плагинов
        }
      }
    }
  }

  /**
   * Приводит данные токена к нужному generic типу
   */
  private castTokenData<T extends ITokenMeta>(
    data: TokenData<ITokenMeta>
  ): TokenData<T> {
    // Здесь можно добавить дополнительную проверку структуры
    // при необходимости в будущем
    return data as unknown as TokenData<T>;
  }
}

/**
 * Фабрика для создания экземпляров TokenRegistryService
 */
export class TokenRegistryServiceFactory {
  /**
   * Создает новый экземпляр сервиса с указанными параметрами
   */
  static create<T extends ITokenMeta = ITokenMeta>(
    adapter: ITokenStoreAdapter,
    config: TokenRegistryConfig,
    validator: ITokenValidator<T>,
    plugins: ITokenPlugin<T>[] = []
  ): TokenRegistryService<T> {
    const service = new TokenRegistryService(adapter, config, validator);

    // Регистрируем все плагины
    plugins.forEach((plugin) => service.registerPlugin(plugin));

    return service;
  }

  /**
   * Создает сервис с конфигурацией по умолчанию
   */
  static createDefault<T extends ITokenMeta = ITokenMeta>(
    adapter: ITokenStoreAdapter,
    validator: ITokenValidator<T>
  ): TokenRegistryService<T> {
    return new TokenRegistryService(adapter, DEFAULT_CONFIG, validator);
  }
}
