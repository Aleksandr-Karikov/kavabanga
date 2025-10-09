import { Injectable } from "@nestjs/common";
import { IErrorClassifier } from "../shared/circuit-breaker/error-classifier.interface";

interface ErrorWithCode extends Error {
  code?: string;
  status?: number;
  statusCode?: number;
  isTimeout?: boolean;
}

@Injectable()
export class RedisErrorClassifier implements IErrorClassifier {
  isCriticalError(error: unknown): boolean {
    const normalizedError = this.normalizeError(error);

    if (this.isRedisError(normalizedError)) {
      return true;
    }

    if (this.isTimeoutError(normalizedError)) {
      return true;
    }

    if (this.isNetworkError(normalizedError)) {
      return true;
    }

    if (this.isBusinessLogicError(normalizedError)) {
      return false;
    }

    return true;
  }

  private isRedisError(error: ErrorWithCode): boolean {
    const redisCodes = ["READONLY", "CLUSTERDOWN", "LOADING", "NOSCRIPT"];
    if (error.code && redisCodes.includes(error.code)) {
      return true;
    }

    const msg = error.message.toLowerCase();
    return msg.includes("redis") || msg.includes("connection to redis");
  }

  private isTimeoutError(error: ErrorWithCode): boolean {
    if (error.code === "ETIMEDOUT" || error.code === "TIMEOUT") {
      return true;
    }
    if (
      error.message.includes("timed out") ||
      error.message.includes("timeout")
    ) {
      return true;
    }
    if (error.isTimeout) {
      return true;
    }
    return false;
  }

  private isNetworkError(error: ErrorWithCode): boolean {
    const networkCodes = [
      "ECONNREFUSED",
      "ENOTFOUND",
      "ECONNRESET",
      "ENETUNREACH",
    ];
    return !!(error.code && networkCodes.includes(error.code));
  }

  private isBusinessLogicError(error: ErrorWithCode): boolean {
    const msg = error.message.toLowerCase();
    const businessKeywords = [
      "invalid token",
      "token not found",
      "token expired",
      "unauthorized",
    ];
    return businessKeywords.some((keyword) => msg.includes(keyword));
  }

  private normalizeError(error: unknown): ErrorWithCode {
    if (error instanceof Error) {
      return error as ErrorWithCode;
    }

    if (typeof error === "string") {
      return new Error(error) as ErrorWithCode;
    }

    if (typeof error === "object" && error !== null) {
      const errorObj = error as Record<string, unknown>;
      const message = errorObj.message
        ? String(errorObj.message)
        : "Unknown error";
      const normalizedError = new Error(message) as ErrorWithCode;

      if (errorObj.code) normalizedError.code = String(errorObj.code);
      if (errorObj.status) normalizedError.status = Number(errorObj.status);
      if (errorObj.statusCode)
        normalizedError.statusCode = Number(errorObj.statusCode);

      return normalizedError;
    }

    return new Error(String(error)) as ErrorWithCode;
  }
}
