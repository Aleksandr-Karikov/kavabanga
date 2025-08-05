import { Injectable } from "@nestjs/common";
import * as Joi from "joi";
import {
  TokenValidationError,
  ConfigurationError,
  RefreshTokenData,
  RefreshTokenStoreConfiguration,
} from "../refresh-token.types";

const RefreshTokenDataSchema = Joi.object({
  userId: Joi.string().min(1).max(255).required(),
  deviceId: Joi.string().min(1).max(255).required(),
  issuedAt: Joi.number().integer().positive().required(),
  used: Joi.boolean().required(),
});

const CreateTokenDataSchema = Joi.object({
  userId: Joi.string().min(1).max(255).required(),
  deviceId: Joi.string().min(1).max(255).required(),
});

@Injectable()
export class TokenValidator {
  /**
   * Validates token string
   * @param token - Token to validate
   * @param maxTokenLength - Maximum allowed token length
   * @throws TokenValidationError if validation fails
   */
  validateToken(token: string, maxTokenLength: number): void {
    if (!token) {
      throw new TokenValidationError("Token is required");
    }

    if (typeof token !== "string") {
      throw new TokenValidationError("Token must be a string");
    }

    if (!token.trim()) {
      throw new TokenValidationError("Token cannot be empty");
    }

    if (token.length > maxTokenLength) {
      throw new TokenValidationError(
        `Token too long: maximum ${maxTokenLength} characters`,
        {
          tokenLength: token.length,
          maxLength: maxTokenLength,
        }
      );
    }
  }

  /**
   * Validates create token data against schema
   * @param data - Token data to validate
   * @throws TokenValidationError if validation fails
   */
  validateCreateTokenData(
    data: unknown
  ): data is Omit<RefreshTokenData, "used" | "issuedAt"> {
    const { error } = CreateTokenDataSchema.validate(data);
    if (error) {
      throw new TokenValidationError(`Invalid token data: ${error.message}`, {
        validationError: error.details,
        providedData: data,
      });
    }
    return true;
  }

  /**
   * Validates token data against schema
   * @param data - Token data to validate
   * @throws TokenValidationError if validation fails
   */
  validateTokenData(data: unknown): data is RefreshTokenData {
    const { error } = RefreshTokenDataSchema.validate(data);
    if (error) {
      throw new TokenValidationError(`Invalid token data: ${error.message}`, {
        validationError: error.details,
      });
    }
    return true;
  }

  /**
   * Validates and normalizes configuration
   * @param inputConfig - Input configuration
   * @returns Validated configuration
   * @throws ConfigurationError if validation fails
   */
  validateConfig(
    inputConfig: Partial<RefreshTokenStoreConfiguration>
  ): RefreshTokenStoreConfiguration {
    const MAX_TTL = 365 * 24 * 60 * 60;
    const USED_MAX_TTL = 60 * 60;

    const config: RefreshTokenStoreConfiguration = {
      enableScheduledCleanup: inputConfig.enableScheduledCleanup ?? true,
      maxDevicesPerUser: inputConfig.maxDevicesPerUser ?? 10,
      maxTokenLength: inputConfig.maxTokenLength ?? 255,
      refreshTokenRedisPrefix: inputConfig.refreshTokenRedisPrefix ?? "refresh",
      userTokensSetRedisPrefix:
        inputConfig.userTokensSetRedisPrefix ?? "user_tokens",
      ttl: inputConfig.ttl ?? 7 * 24 * 60 * 60,
      usedTokenTtl: inputConfig.usedTokenTtl ?? 5 * 60,
      maxBatchSize: inputConfig.maxBatchSize ?? 300,
    };

    if (config.ttl < 1 || config.ttl > MAX_TTL) {
      throw new ConfigurationError(
        `Invalid ttl: must be between 1 and ${MAX_TTL}`,
        { ttl: inputConfig.ttl }
      );
    }

    if (config.usedTokenTtl < 1 || config.usedTokenTtl > USED_MAX_TTL) {
      throw new ConfigurationError(
        `Invalid usedTokenTtl: must be between 1 and ${USED_MAX_TTL}`,
        { usedTokenTtl: config.usedTokenTtl }
      );
    }

    return config;
  }

  /**
   * Validates batch tokens data
   * @param tokens - Array of tokens to validate
   * @param maxBatchSize - Maximum batch size
   * @param maxTokenLength - Maximum token length
   * @returns Array of valid tokens
   */
  validateBatchTokens(
    tokens: Array<{
      token: string;
      data: Omit<RefreshTokenData, "used" | "issuedAt">;
    }>,
    maxBatchSize: number,
    maxTokenLength: number
  ): Array<{
    token: string;
    data: Omit<RefreshTokenData, "used" | "issuedAt">;
  }> {
    if (!tokens || tokens.length === 0) {
      return [];
    }

    if (tokens.length > maxBatchSize) {
      throw new TokenValidationError(
        `Batch size exceeded limit: ${maxBatchSize}`
      );
    }

    const validTokens: typeof tokens = [];

    for (const tokenData of tokens) {
      try {
        this.validateToken(tokenData.token, maxTokenLength);
        this.validateCreateTokenData(tokenData.data);
        validTokens.push(tokenData);
      } catch {
        continue;
      }
    }

    return validTokens;
  }
}
