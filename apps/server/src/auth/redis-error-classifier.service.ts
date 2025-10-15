import { Injectable } from "@nestjs/common";
import { IErrorClassifier } from "../shared/circuit-breaker/error-classifier.interface";
import { TokenRegistryError } from "@kavabanga/token-registry-core";

/**
 * Классифицирует ошибки для circuit breaker на основе типов ошибок.
 *
 * Использует instanceof для точной идентификации типов ошибок.
 * Все типы ошибок имеют флаг isCritical, который определяет поведение.
 *
 * Critical errors (открывают circuit breaker):
 * - TokenStoreConnectionError - проблемы с подключением к Redis
 * - TokenTimeoutError - таймауты операций
 * - TokenOperationError с isCritical=true
 *
 * Business errors (НЕ открывают circuit breaker):
 * - TokenValidationError - ошибки валидации входных данных
 * - TokenNotFoundError - токен не найден
 * - TokenAlreadyExistsError - попытка создать дубликат
 * - TokenExpiredError - попытка работы с истекшим токеном
 * - TokenOperationError с isCritical=false
 */
@Injectable()
export class RedisErrorClassifier implements IErrorClassifier {
  isCriticalError(error: unknown): boolean {
    // Если это TokenRegistryError - используем встроенный флаг
    if (error instanceof TokenRegistryError) {
      return error.isCritical;
    }

    // Если это не TokenRegistryError - считаем критичной (безопасный подход)
    // Это покрывает случаи неожиданных ошибок, которые не были обработаны
    return true;
  }
}
