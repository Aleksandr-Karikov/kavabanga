import { Inject } from "@nestjs/common";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from "@nestjs/common";
import CircuitBreaker from "opossum";
import { IErrorClassifier } from "./error-classifier.interface";

@Injectable()
export class CircuitBreakerManager {
  private readonly logger = new Logger(CircuitBreakerManager.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    @Inject("IErrorClassifier")
    private readonly errorClassifier: IErrorClassifier
  ) {}

  createBreaker(
    operationName: string,
    action: (...args: any[]) => Promise<any>,
    options: CircuitBreaker.Options = {}
  ): CircuitBreaker {
    const defaultOptions: CircuitBreaker.Options = {
      timeout: 3000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      ...options,
    };

    const breaker = new CircuitBreaker(action, defaultOptions);

    breaker.fallback((err) => {
      if (this.errorClassifier.isCriticalError(err)) {
        this.logger.error(
          `Fallback for ${operationName} due to critical error`,
          err
        );
        throw err;
      }
      return Promise.reject(err);
    });

    breaker.on("open", () =>
      this.logger.warn(`Circuit breaker OPEN for ${operationName}`)
    );
    breaker.on("halfOpen", () =>
      this.logger.log(`Circuit breaker HALF_OPEN for ${operationName}`)
    );
    breaker.on("close", () =>
      this.logger.log(`Circuit breaker CLOSE for ${operationName}`)
    );
    breaker.on("failure", (err) => {
      if (this.errorClassifier.isCriticalError(err)) {
        this.logger.error(`Circuit breaker FAILURE for ${operationName}`, err);
      }
    });

    this.breakers.set(operationName, breaker);
    return breaker;
  }

  getBreaker(operationName: string): CircuitBreaker | undefined {
    return this.breakers.get(operationName);
  }

  async fire(
    operationName: string,
    action: (...args: any[]) => Promise<any>,
    args: any[],
    options?: CircuitBreaker.Options
  ): Promise<any> {
    let breaker = this.breakers.get(operationName);
    if (!breaker) {
      breaker = this.createBreaker(operationName, action, options);
    }
    return breaker.fire(...args);
  }
}
