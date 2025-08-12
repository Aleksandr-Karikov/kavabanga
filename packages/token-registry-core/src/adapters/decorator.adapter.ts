// ===================== DECORATOR PATTERN BASE =====================

import {
  ITokenStoreAdapter,
  TokenData,
  TokenSaveRequest,
} from "../core/interfaces";

/**
 * Базовый класс для декораторов адаптеров
 *
 * Реализует паттерн Decorator для композиции возможностей адаптеров.
 * Позволяет оборачивать любой адаптер и добавлять дополнительную функциональность
 * без изменения интерфейса.
 */
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
