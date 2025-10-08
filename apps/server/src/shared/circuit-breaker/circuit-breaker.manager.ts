import { Inject, Injectable, Logger } from "@nestjs/common";
import CircuitBreaker from "opossum";
import { IErrorClassifier } from "./error-classifier.interface";

interface CircuitBreakerError extends Error {
  code?: string;
  timeout?: number;
}

export interface CircuitBreakerOptions extends CircuitBreaker.Options {
  fallbackFn?: (error: Error, ...args: unknown[]) => unknown;
}

@Injectable()
export class CircuitBreakerManager {
  private readonly logger = new Logger(CircuitBreakerManager.name);
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly lastErrors = new Map<string, Error>();

  constructor(
    @Inject("IErrorClassifier")
    private readonly errorClassifier: IErrorClassifier
  ) {}

  createBreaker<T extends unknown[], R>(
    operationName: string,
    action: (...args: T) => Promise<R>,
    options: CircuitBreakerOptions = {}
  ): CircuitBreaker {
    const { fallbackFn, ...opossumOptions } = options;

    const defaultOptions: CircuitBreaker.Options = {
      timeout: 5000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      volumeThreshold: 3,
      ...opossumOptions,
    };

    const breaker = new CircuitBreaker(action, defaultOptions);

    breaker.fallback((...args: unknown[]) => {
      const lastError =
        this.lastErrors.get(operationName) || new Error("Unknown error");
      const isCritical = this.errorClassifier.isCriticalError(lastError);

      if (isCritical) {
        this.logger.error(
          `[Fallback] Circuit breaker rejecting request for ${operationName}: ${lastError.message}`
        );
        throw lastError;
      }

      this.logger.warn(
        `[Fallback] Using fallback for ${operationName}: ${lastError.message}`
      );
      if (fallbackFn) {
        return fallbackFn(lastError, ...args);
      }
      return Promise.resolve(undefined);
    });

    breaker.on("open", () => {
      this.logger.error(
        `Circuit breaker OPEN for ${operationName}. Requests will be rejected until service recovers.`
      );
    });

    breaker.on("halfOpen", () => {
      this.logger.warn(
        `Circuit breaker HALF_OPEN for ${operationName}. Testing if service recovered.`
      );
    });

    breaker.on("close", () => {
      this.logger.log(
        `Circuit breaker CLOSED for ${operationName}. Service is healthy.`
      );
      this.lastErrors.delete(operationName);
    });

    breaker.on("failure", (err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.lastErrors.set(operationName, error);

      const isCritical = this.errorClassifier.isCriticalError(err);
      const errorMessage = this.getTechnicalErrorMessage(err);

      if (isCritical) {
        this.logger.error(
          `[Failure] Critical error in ${operationName}: ${errorMessage}`
        );
      } else {
        this.logger.warn(
          `[Failure] Non-critical error in ${operationName}: ${errorMessage}`
        );
      }
    });

    breaker.on("timeout", () => {
      const timeoutError = new Error(
        `Operation timed out after ${defaultOptions.timeout}ms`
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (timeoutError as any).code = "ETIMEDOUT";
      this.lastErrors.set(operationName, timeoutError);

      this.logger.warn(
        `Timeout in ${operationName} after ${defaultOptions.timeout}ms`
      );
    });

    breaker.on("reject", () => {
      const rejectError = new Error("Circuit breaker is OPEN");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (rejectError as any).code = "CIRCUIT_OPEN";
      this.lastErrors.set(operationName, rejectError);

      this.logger.warn(
        `Request rejected for ${operationName} (circuit breaker is OPEN)`
      );
    });

    breaker.on("success", () => {
      this.lastErrors.delete(operationName);
      this.logger.debug(`Operation ${operationName} succeeded`);
    });

    this.breakers.set(operationName, breaker);
    return breaker;
  }

  getBreaker(operationName: string): CircuitBreaker | undefined {
    return this.breakers.get(operationName);
  }

  async fire<T extends unknown[], R>(
    operationName: string,
    action: (...args: T) => Promise<R>,
    args: T,
    options?: CircuitBreakerOptions
  ): Promise<R> {
    let breaker = this.breakers.get(operationName);
    if (!breaker) {
      breaker = this.createBreaker(operationName, action, options);
    }

    return breaker.fire(...args) as Promise<R>;
  }

  private getTechnicalErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const circuitError = error as CircuitBreakerError;
      if (circuitError.code === "ETIMEDOUT") {
        return `Operation timed out`;
      }
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    if (typeof error === "object" && error !== null) {
      const errorObj = error as Record<string, unknown>;
      if (errorObj.message) return String(errorObj.message);
      if (errorObj.error) return String(errorObj.error);
    }

    return "Unknown error occurred";
  }

  getStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {};

    this.breakers.forEach((breaker, name) => {
      stats[name] = {
        state: breaker.opened
          ? "OPEN"
          : breaker.halfOpen
            ? "HALF_OPEN"
            : "CLOSED",
        stats: breaker.stats,
      };
    });

    return stats;
  }

  closeBreaker(operationName: string): void {
    const breaker = this.breakers.get(operationName);
    if (breaker) {
      breaker.close();
      this.lastErrors.delete(operationName);
      this.logger.log(`Circuit breaker manually closed for ${operationName}`);
    }
  }
}
