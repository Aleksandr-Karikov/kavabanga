export interface IErrorClassifier {
  isCriticalError(error: unknown): boolean;
}

export interface CriticalError extends Error {
  name: string;
  message: string;
  code?: string;
  status?: number;
  statusCode?: number;
}

export interface DatabaseError extends CriticalError {
  code: string;
  sqlState?: string;
}

export interface RedisError extends CriticalError {
  code: string;
  command?: string;
}

export interface NetworkError extends CriticalError {
  code: string;
  address?: string;
  port?: number;
}

export interface HttpError extends CriticalError {
  status: number;
  statusCode: number;
  response?: unknown;
}

export type CircuitBreakerError =
  | CriticalError
  | DatabaseError
  | RedisError
  | NetworkError
  | HttpError
  | Error;
