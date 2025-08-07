/* eslint-disable @typescript-eslint/no-unsafe-function-type */
import { IErrorClassifier } from "./error-classifier.interface";

export class BaseErrorClassifier implements IErrorClassifier {
  private nonCriticalErrors: Function[];

  constructor(nonCriticalErrors: Function[] = []) {
    this.nonCriticalErrors = nonCriticalErrors;
  }

  isCriticalError(error: unknown): boolean {
    return (
      error instanceof Error &&
      !this.nonCriticalErrors.some((cls) => error instanceof cls)
    );
  }
}
