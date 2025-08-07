export interface IErrorClassifier {
  isCriticalError(error: unknown): boolean;
}
