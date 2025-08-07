import {
  TokenOperationFailedError,
  TokenValidationError,
} from "src/auth/refresh-token/refresh-token.types";
import { BaseErrorClassifier } from "src/common/base-error-classifier";

export class TokenErrorClassifier extends BaseErrorClassifier {
  constructor() {
    super([TokenOperationFailedError, TokenValidationError]);
  }
}
