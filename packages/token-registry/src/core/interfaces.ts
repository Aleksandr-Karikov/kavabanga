// ===================== BASE INTERFACES =====================

export interface ITokenMeta {
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
  fingerprint?: string;
  [customKey: string]: unknown;
}

export interface TokenData<T extends ITokenMeta = ITokenMeta> {
  sub: string;
  issuedAt: number;
  expiresAt: number;
  meta: T;
  version?: string;
}

export interface TokenSaveRequest<T extends ITokenMeta = ITokenMeta> {
  token: string;
  data: TokenData<T>;
  ttl: number;
}

// ===================== CORE STORE ADAPTER INTERFACE =====================

export interface ITokenStoreAdapter {
  /**
   * Сохраняет токен с указанными данными и TTL
   */
  saveToken(request: TokenSaveRequest): Promise<void>;

  /**
   * Получает данные токена по токену
   * @returns TokenData или null если токен не найден
   */
  getTokenData(token: string): Promise<TokenData | null>;

  /**
   * Удаляет конкретный токен
   */
  deleteToken(token: string): Promise<void>;

  /**
   * Пакетное сохранение токенов для производительности
   */
  saveBatchTokens(requests: TokenSaveRequest[]): Promise<void>;

  /**
   * Проверяет здоровье адаптера
   */
  isHealthy(): Promise<boolean>;
}

// ===================== PLUGIN INTERFACES =====================

export interface ITokenPlugin<T extends ITokenMeta = ITokenMeta> {
  readonly name: string;
  readonly priority: number; // Меньшее значение = выше приоритет

  /**
   * Вызывается перед сохранением токена
   * Может модифицировать данные для сохранения
   */
  preSave?(request: TokenSaveRequest<T>): Promise<TokenSaveRequest<T>>;

  /**
   * Вызывается после успешного сохранения токена
   */
  postSave?(request: TokenSaveRequest<T>): Promise<void>;

  /**
   * Вызывается перед получением данных токена
   */
  preGet?(token: string): Promise<void>;

  /**
   * Вызывается после получения данных токена
   */
  postGet?(token: string, data: TokenData<T> | null): Promise<void>;

  /**
   * Вызывается перед удалением токена
   */
  preRevoke?(token: string, data: TokenData<T>): Promise<void>;

  /**
   * Вызывается после удаления токена
   */
  postRevoke?(token: string, data: TokenData<T>): Promise<void>;

  /**
   * Вызывается при ошибках
   */
  onError?(operation: string, error: Error, context?: any): Promise<void>;
}

// ===================== VALIDATOR INTERFACE =====================

export interface ITokenValidator<T extends ITokenMeta = ITokenMeta> {
  /**
   * Валидирует запрос на сохранение токена
   * @throws TokenValidationError при ошибке валидации
   */
  validate(request: TokenSaveRequest<T>): Promise<void>;
}

// ===================== CONFIGURATION =====================

export interface TokenRegistryConfig {
  /**
   * Включить валидацию входных данных
   */
  enableValidation: boolean;

  /**
   * TTL по умолчанию в секундах (30 дней)
   */
  defaultTtl: number;

  /**
   * Включить выполнение плагинов
   */
  enablePlugins: boolean;

  /**
   * Строгий режим - дополнительные проверки
   */
  strictMode: boolean;

  /**
   * Таймаут для операций в миллисекундах
   */
  operationTimeout: number;
}

export const DEFAULT_CONFIG: TokenRegistryConfig = {
  enableValidation: true,
  defaultTtl: 30 * 24 * 60 * 60, // 30 дней в секундах
  enablePlugins: true,
  strictMode: false,
  operationTimeout: 5000, // 5 секунд
};

// ===================== ERROR CLASSES =====================

export abstract class TokenRegistryError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;

    // Для правильного instanceof в TypeScript
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }
}

export class TokenValidationError extends TokenRegistryError {
  readonly code = "VALIDATION_ERROR";

  constructor(message: string, context?: Record<string, unknown>) {
    super(`Validation failed: ${message}`, context);
  }
}

export class TokenNotFoundError extends TokenRegistryError {
  readonly code = "TOKEN_NOT_FOUND";

  constructor(token?: string) {
    super("Token not found", { token });
  }
}

export class TokenOperationError extends TokenRegistryError {
  readonly code = "OPERATION_FAILED";

  constructor(
    operation: string,
    originalError: Error,
    context?: Record<string, unknown>
  ) {
    super(`Operation '${operation}' failed: ${originalError.message}`, {
      ...context,
      originalError: originalError.message,
      originalStack: originalError.stack,
    });
  }
}

export class TokenConfigurationError extends TokenRegistryError {
  readonly code = "CONFIGURATION_ERROR";

  constructor(message: string, context?: Record<string, unknown>) {
    super(`Configuration error: ${message}`, context);
  }
}

export class TokenTimeoutError extends TokenRegistryError {
  readonly code = "TIMEOUT_ERROR";

  constructor(operation: string, timeout: number) {
    super(`Operation '${operation}' timed out after ${timeout}ms`, {
      operation,
      timeout,
    });
  }
}

// ===================== UTILITY TYPES =====================

export type PluginHook =
  | "preSave"
  | "postSave"
  | "preGet"
  | "postGet"
  | "preRevoke"
  | "postRevoke"
  | "onError";

export interface PluginExecutionContext<T extends ITokenMeta = ITokenMeta> {
  hook: PluginHook;
  token?: string;
  data?: TokenData<T>;
  request?: TokenSaveRequest<T>;
  error?: Error;
}

// ===================== EXTENSION INTERFACES =====================

export abstract class TokenRegistryExtension<
  T extends ITokenMeta = ITokenMeta,
> {
  constructor(protected readonly service: TokenRegistryService<T>) {}

  protected get adapter(): ITokenStoreAdapter {
    return this.service.getStoreAdapter();
  }

  protected get config(): TokenRegistryConfig {
    return this.service.getConfig();
  }
}

// Интерфейс для расширений с возможностью поиска токенов
export interface ITokenSearchCapability {
  /**
   * Проверяет, поддерживает ли адаптер поиск
   */
  supportsSearch(): boolean;
}

// Предварительное объявление класса для циклических зависимостей
export declare class TokenRegistryService<T extends ITokenMeta = ITokenMeta> {
  getStoreAdapter(): ITokenStoreAdapter;
  getConfig(): TokenRegistryConfig;
}
