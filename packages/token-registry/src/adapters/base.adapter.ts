import {
  ITokenStoreAdapter,
  TokenSaveRequest,
  TokenData,
  TokenOperationError,
} from "../core/interfaces";

// ===================== ABSTRACT BASE ADAPTER =====================

export abstract class BaseStoreAdapter implements ITokenStoreAdapter {
  /**
   * Сохраняет токен с указанными данными и TTL
   */
  abstract saveToken(request: TokenSaveRequest): Promise<void>;

  /**
   * Получает данные токена по токену
   */
  abstract getTokenData(token: string): Promise<TokenData | null>;

  /**
   * Удаляет конкретный токен
   */
  abstract deleteToken(token: string): Promise<void>;

  /**
   * Пакетное сохранение токенов
   */
  async saveBatchTokens(requests: TokenSaveRequest[]): Promise<void> {
    // Базовая реализация - последовательное сохранение
    // Конкретные адаптеры могут переопределить для оптимизации
    for (const request of requests) {
      await this.saveToken(request);
    }
  }

  /**
   * Проверяет здоровье адаптера
   */
  abstract isHealthy(): Promise<boolean>;

  /**
   * Утилитный метод для обработки ошибок
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
   * Валидирует токен (базовая проверка)
   */
  protected validateToken(token: string): void {
    if (!token || typeof token !== "string") {
      throw new Error("Invalid token format");
    }
  }

  /**
   * Создает ключ для хранения токена (может быть переопределен)
   */
  protected getTokenKey(token: string): string {
    return `token:${token}`;
  }
}

// ===================== IN-MEMORY ADAPTER =====================

export class InMemoryStoreAdapter extends BaseStoreAdapter {
  private readonly tokens = new Map<string, TokenData>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  async saveToken(request: TokenSaveRequest): Promise<void> {
    try {
      const { token, data, ttl } = request;
      this.validateToken(token);

      // Очищаем существующий таймер если есть
      this.clearExistingTimer(token);

      // Сохраняем данные
      this.tokens.set(token, data);

      // Устанавливаем таймер для автоматического удаления
      const timer = setTimeout(() => {
        this.tokens.delete(token);
        this.timers.delete(token);
      }, ttl * 1000);

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

  async saveBatchTokens(requests: TokenSaveRequest[]): Promise<void> {
    // Оптимизированная пакетная операция
    try {
      for (const request of requests) {
        await this.saveToken(request);
      }
    } catch (error) {
      this.handleError("saveBatchTokens", error, {
        batchSize: requests.length,
      });
    }
  }

  async isHealthy(): Promise<boolean> {
    // In-memory адаптер всегда здоров
    return true;
  }

  /**
   * Получает количество активных токенов (для тестирования/мониторинга)
   */
  getActiveTokenCount(): number {
    return this.tokens.size;
  }

  /**
   * Очищает все токены (для тестирования)
   */
  clear(): void {
    // Очищаем все таймеры
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.tokens.clear();
    this.timers.clear();
  }

  private clearExistingTimer(token: string): void {
    const existingTimer = this.timers.get(token);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(token);
    }
  }
}

// ===================== DECORATOR PATTERN BASE =====================

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

  async saveBatchTokens(requests: TokenSaveRequest[]): Promise<void> {
    return this.wrapped.saveBatchTokens(requests);
  }

  async isHealthy(): Promise<boolean> {
    return this.wrapped.isHealthy();
  }

  /**
   * Предоставляет доступ к оборачиваемому адаптеру
   */
  protected getWrapped(): ITokenStoreAdapter {
    return this.wrapped;
  }

  /**
   * Получает самый глубокий адаптер в цепочке декораторов
   */
  protected getInnerMost(): ITokenStoreAdapter {
    let current: ITokenStoreAdapter = this.wrapped;

    while (current instanceof StoreAdapterDecorator) {
      current = current.getWrapped();
    }

    return current;
  }
}

// ===================== LOGGING ADAPTER =====================

export class LoggingStoreAdapter extends StoreAdapterDecorator {
  constructor(
    wrapped: ITokenStoreAdapter,
    private readonly logger?: {
      log: (message: string, context?: any) => void;
      error: (message: string, error?: any, context?: any) => void;
    }
  ) {
    super(wrapped);
    this.logger = logger || console;
  }

  async saveToken(request: TokenSaveRequest): Promise<void> {
    const start = Date.now();

    try {
      await super.saveToken(request);

      const duration = Date.now() - start;
      this.logger?.log("Token saved successfully", {
        subject: request.data.sub,
        ttl: request.ttl,
        duration,
        deviceId: request.data.meta.deviceId,
      });
    } catch (error) {
      const duration = Date.now() - start;
      this.logger?.error("Failed to save token", error, {
        subject: request.data.sub,
        duration,
      });
      throw error;
    }
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    const start = Date.now();

    try {
      const result = await super.getTokenData(token);

      const duration = Date.now() - start;
      this.logger?.log("Token data retrieved", {
        found: !!result,
        subject: result?.sub,
        duration,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.logger?.error("Failed to get token data", error, { duration });
      throw error;
    }
  }

  async deleteToken(token: string): Promise<void> {
    const start = Date.now();

    try {
      await super.deleteToken(token);

      const duration = Date.now() - start;
      this.logger?.log("Token deleted successfully", { duration });
    } catch (error) {
      const duration = Date.now() - start;
      this.logger?.error("Failed to delete token", error, { duration });
      throw error;
    }
  }

  async saveBatchTokens(requests: TokenSaveRequest[]): Promise<void> {
    const start = Date.now();

    try {
      await super.saveBatchTokens(requests);

      const duration = Date.now() - start;
      this.logger?.log("Batch tokens saved successfully", {
        count: requests.length,
        duration,
        subjects: requests.map((r) => r.data.sub),
      });
    } catch (error) {
      const duration = Date.now() - start;
      this.logger?.error("Failed to save batch tokens", error, {
        count: requests.length,
        duration,
      });
      throw error;
    }
  }
}

// ===================== FAILOVER ADAPTER =====================

export class FailoverStoreAdapter extends StoreAdapterDecorator {
  constructor(
    primary: ITokenStoreAdapter,
    private readonly fallback: ITokenStoreAdapter,
    private readonly options: {
      /**
       * Количество попыток на первичном адаптере перед переключением на резервный
       */
      maxRetries?: number;
      /**
       * Таймаут для каждой операции в миллисекундах
       */
      operationTimeout?: number;
    } = {}
  ) {
    super(primary);

    if (!fallback) {
      throw new Error("Fallback adapter is required");
    }

    this.options = {
      maxRetries: 1,
      operationTimeout: 5000,
      ...options,
    };
  }

  async saveToken(request: TokenSaveRequest): Promise<void> {
    return this.executeWithFailover("saveToken", async (adapter) => {
      return adapter.saveToken(request);
    });
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    return this.executeWithFailover("getTokenData", async (adapter) => {
      return adapter.getTokenData(token);
    });
  }

  async deleteToken(token: string): Promise<void> {
    return this.executeWithFailover("deleteToken", async (adapter) => {
      return adapter.deleteToken(token);
    });
  }

  async saveBatchTokens(requests: TokenSaveRequest[]): Promise<void> {
    return this.executeWithFailover("saveBatchTokens", async (adapter) => {
      return adapter.saveBatchTokens(requests);
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      return await this.wrapped.isHealthy();
    } catch {
      try {
        return await this.fallback.isHealthy();
      } catch {
        return false;
      }
    }
  }

  private async executeWithFailover<T>(
    operation: string,
    fn: (adapter: ITokenStoreAdapter) => Promise<T>
  ): Promise<T> {
    // Пытаемся выполнить на основном адаптере
    for (let attempt = 0; attempt < this.options.maxRetries!; attempt++) {
      try {
        return await this.withTimeout(fn(this.wrapped));
      } catch (error) {
        if (attempt === this.options.maxRetries! - 1) {
          // Последняя попытка на основном адаптере неудачна, переключаемся на резервный
          break;
        }
        // Ждем перед следующей попыткой
        await this.delay(Math.pow(2, attempt) * 100);
      }
    }

    // Пытаемся выполнить на резервном адаптере
    try {
      return await this.withTimeout(fn(this.fallback));
    } catch (fallbackError) {
      throw new TokenOperationError(
        `Both primary and fallback adapters failed for operation '${operation}'`,
        fallbackError as Error
      );
    }
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    if (this.options.operationTimeout! <= 0) {
      return promise;
    }

    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Operation timeout after ${this.options.operationTimeout}ms`
            )
          );
        }, this.options.operationTimeout);
      }),
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
