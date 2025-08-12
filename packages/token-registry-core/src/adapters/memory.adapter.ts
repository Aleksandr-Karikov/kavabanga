import { TokenSaveRequest, TokenData } from "../core/interfaces";
import { BaseStoreAdapter } from "./abstract.adapter";

// ===================== IN-MEMORY ADAPTER =====================

/**
 * In-Memory адаптер для хранения токенов в памяти
 *
 * Простой и быстрый адаптер для разработки, тестирования и небольших приложений.
 * Автоматически удаляет токены по истечении TTL с использованием таймеров Node.js.
 */
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
   * Получает список всех активных токенов (для отладки)
   */
  getActiveTokens(): string[] {
    return Array.from(this.tokens.keys());
  }

  /**
   * Получает информацию о таймерах (для отладки)
   */
  getTimersInfo(): Array<{ token: string; hasTimer: boolean }> {
    return Array.from(this.tokens.keys()).map((token) => ({
      token,
      hasTimer: this.timers.has(token),
    }));
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

  /**
   * Принудительно истекает токен (для тестирования)
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
   * Получает статистику адаптера
   */
  getStats(): {
    totalTokens: number;
    activeTimers: number;
    memoryUsage: string;
  } {
    const totalTokens = this.tokens.size;
    const activeTimers = this.timers.size;

    // Примерная оценка использования памяти
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
 * Создает in-memory адаптер для разработки
 */
export function createDevelopmentMemoryAdapter(): InMemoryStoreAdapter {
  return new InMemoryStoreAdapter();
}

/**
 * Создает in-memory адаптер для тестирования с дополнительными утилитами
 */
export function createTestMemoryAdapter(): InMemoryStoreAdapter {
  const adapter = new InMemoryStoreAdapter();

  // Добавляем дополнительные методы для тестов
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
