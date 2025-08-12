// ===================== ABSTRACT BASE ADAPTER =====================

import {
  ITokenStoreAdapter,
  TokenData,
  TokenOperationError,
  TokenSaveRequest,
} from "../core/interfaces";

/**
 * Абстрактный базовый адаптер с общими утилитами
 *
 * Предоставляет базовую функциональность для всех адаптеров хранения токенов,
 * включая обработку ошибок, валидацию и генерацию ключей.
 */
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
