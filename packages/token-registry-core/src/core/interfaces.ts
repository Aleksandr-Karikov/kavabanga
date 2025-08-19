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

// ===================== SIMPLIFIED STORE INTERFACE =====================

export interface ITokenStore {
  /**
   * Saves token with specified data and TTL
   */
  save(token: string, data: TokenData, ttl: number): Promise<void>;

  /**
   * Gets token data by token
   * @returns TokenData or null if token not found
   */
  get(token: string): Promise<TokenData | null>;

  /**
   * Deletes specific token
   */
  delete(token: string): Promise<void>;

  /**
   * Checks store health
   */
  health(): Promise<boolean>;
}

// ===================== SIMPLIFIED VALIDATOR INTERFACE =====================

export interface ITokenValidator<T extends ITokenMeta = ITokenMeta> {
  /**
   * Validates token data before saving
   * @throws TokenValidationError on validation error
   */
  validate(token: string, data: TokenData<T>, ttl: number): Promise<void>;
}

// ===================== SIMPLIFIED EVENT HANDLER INTERFACE =====================

export interface TokenEventHandler<T extends ITokenMeta = ITokenMeta> {
  /**
   * Called when token is created
   */
  onTokenCreated?(token: string, data: TokenData<T>): Promise<void>;

  /**
   * Called when token is accessed
   */
  onTokenAccessed?(token: string, data: TokenData<T>): Promise<void>;

  /**
   * Called when token is revoked
   */
  onTokenRevoked?(token: string, data: TokenData<T>): Promise<void>;
}

// ===================== SIMPLIFIED CONFIGURATION =====================

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
   * Enable event handlers
   */
  enableEvents: boolean;

  /**
   * Operation timeout in milliseconds
   */
  operationTimeout: number;
}

export const DEFAULT_CONFIG: TokenRegistryConfig = Object.freeze({
  enableValidation: true,
  defaultTtl: 30 * 24 * 60 * 60, // 30 days in seconds
  enableEvents: true,
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

export type TokenOperation = "save" | "get" | "delete" | "health";

// Forward class declaration for circular dependencies
export declare class TokenRegistryService<T extends ITokenMeta = ITokenMeta> {
  getStore(): ITokenStore;
  getConfig(): TokenRegistryConfig;
}
