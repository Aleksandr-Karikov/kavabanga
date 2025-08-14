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
   * Saves token with specified data and TTL
   */
  saveToken(request: TokenSaveRequest): Promise<void>;

  /**
   * Gets token data by token
   * @returns TokenData or null if token not found
   */
  getTokenData(token: string): Promise<TokenData | null>;

  /**
   * Deletes specific token
   */
  deleteToken(token: string): Promise<void>;

  /**
   * Checks adapter health
   */
  isHealthy(): Promise<boolean>;
}

// ===================== PLUGIN INTERFACES =====================

export interface ITokenPlugin<T extends ITokenMeta = ITokenMeta> {
  readonly name: string;
  readonly priority: number; // Lower value = higher priority

  /**
   * Called before token saving
   * Can modify data for saving
   */
  preSave?(request: TokenSaveRequest<T>): Promise<TokenSaveRequest<T>>;

  /**
   * Called after successful token saving
   */
  postSave?(request: TokenSaveRequest<T>): Promise<void>;

  /**
   * Called before getting token data
   */
  preGet?(token: string): Promise<void>;

  /**
   * Called after getting token data
   */
  postGet?(token: string, data: TokenData<T> | null): Promise<void>;

  /**
   * Called before token deletion
   */
  preRevoke?(token: string, data: TokenData<T>): Promise<void>;

  /**
   * Called after token deletion
   */
  postRevoke?(token: string, data: TokenData<T>): Promise<void>;

  /**
   * Called on errors
   */
  onError?(operation: string, error: Error, context?: any): Promise<void>;
}

// ===================== VALIDATOR INTERFACE =====================

export interface ITokenValidator<T extends ITokenMeta = ITokenMeta> {
  /**
   * Validates token save request
   * @throws TokenValidationError on validation error
   */
  validate(request: TokenSaveRequest<T>): Promise<void>;
}

// ===================== CONFIGURATION =====================

export interface TokenRegistryConfig {
  /**
   * Enable input data validation
   */
  enableValidation: boolean;

  /**
   * Default TTL in seconds (30 days)
   */
  defaultTtl: number;

  /**
   * Enable plugin execution
   */
  enablePlugins: boolean;

  /**
   * Strict mode - additional checks
   */
  strictMode: boolean;

  /**
   * Operation timeout in milliseconds
   */
  operationTimeout: number;
}

export const DEFAULT_CONFIG: TokenRegistryConfig = Object.freeze({
  enableValidation: true,
  defaultTtl: 30 * 24 * 60 * 60, // 30 days in seconds
  enablePlugins: true,
  strictMode: false,
  operationTimeout: 5000, // 5 seconds
});

// ===================== ERROR CLASSES =====================

export abstract class TokenRegistryError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;

    // For proper instanceof in TypeScript
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

// Forward class declaration for circular dependencies
export declare class TokenRegistryService<T extends ITokenMeta = ITokenMeta> {
  getStoreAdapter(): ITokenStoreAdapter;
  getConfig(): TokenRegistryConfig;
}
