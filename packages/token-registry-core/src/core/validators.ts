import {
  ITokenValidator,
  ITokenMeta,
  TokenSaveRequest,
  TokenValidationError,
  TokenRegistryConfig,
} from "./interfaces";

// ===================== DEFAULT VALIDATOR =====================

export class DefaultTokenValidator<T extends ITokenMeta = ITokenMeta>
  implements ITokenValidator<T>
{
  constructor(private readonly config: TokenRegistryConfig) {}

  async validate(request: TokenSaveRequest<T>): Promise<void> {
    await Promise.all([
      this.validateToken(request.token),
      this.validateTokenData(request.data),
      this.validateTtl(request.ttl),
    ]);

    if (this.config.strictMode) {
      await this.validateStrict(request);
    }
  }

  private async validateToken(token: string): Promise<void> {
    if (!token) {
      throw new TokenValidationError("Token is required");
    }

    if (typeof token !== "string") {
      throw new TokenValidationError("Token must be a string", {
        receivedType: typeof token,
      });
    }

    if (token.trim().length === 0) {
      throw new TokenValidationError("Token cannot be empty");
    }

    if (token.length < 8) {
      throw new TokenValidationError("Token too short (minimum 8 characters)", {
        tokenLength: token.length,
        minLength: 8,
      });
    }

    if (token.length > 512) {
      throw new TokenValidationError(
        "Token too long (maximum 512 characters)",
        {
          tokenLength: token.length,
          maxLength: 512,
        }
      );
    }

    // Check for invalid characters
    if (!/^[a-zA-Z0-9._-]+$/.test(token)) {
      throw new TokenValidationError(
        "Token contains invalid characters (allowed: a-z, A-Z, 0-9, ., _, -)"
      );
    }
  }

  private async validateTokenData(data: any): Promise<void> {
    if (!data) {
      throw new TokenValidationError("Token data is required");
    }

    if (typeof data !== "object") {
      throw new TokenValidationError("Token data must be an object", {
        receivedType: typeof data,
      });
    }

    // Validate sub (subject)
    await this.validateSubject(data.sub);

    // Validate timestamps
    await this.validateTimestamps(data.issuedAt, data.expiresAt);

    // Validate meta
    await this.validateMeta(data.meta);

    // Validate version (optional)
    if (data.version !== undefined) {
      await this.validateVersion(data.version);
    }
  }

  private async validateSubject(sub: any): Promise<void> {
    if (!sub && sub !== "") {
      throw new TokenValidationError("Subject (sub) is required");
    }

    if (typeof sub !== "string") {
      throw new TokenValidationError("Subject must be a string", {
        receivedType: typeof sub,
      });
    }

    if (sub.trim().length === 0) {
      throw new TokenValidationError("Subject cannot be empty");
    }

    if (sub.length > 255) {
      throw new TokenValidationError(
        "Subject too long (maximum 255 characters)",
        {
          subjectLength: sub.length,
          maxLength: 255,
        }
      );
    }
  }

  private async validateTimestamps(
    issuedAt: any,
    expiresAt: any
  ): Promise<void> {
    // Validate issuedAt
    if (issuedAt === undefined || issuedAt === null) {
      throw new TokenValidationError("issuedAt timestamp is required");
    }

    if (!Number.isInteger(issuedAt) || issuedAt <= 0) {
      throw new TokenValidationError(
        "issuedAt must be a positive integer timestamp",
        {
          receivedValue: issuedAt,
          receivedType: typeof issuedAt,
        }
      );
    }

    // Validate expiresAt
    if (expiresAt === undefined || expiresAt === null) {
      throw new TokenValidationError("expiresAt timestamp is required");
    }

    if (!Number.isInteger(expiresAt) || expiresAt <= 0) {
      throw new TokenValidationError(
        "expiresAt must be a positive integer timestamp",
        {
          receivedValue: expiresAt,
          receivedType: typeof expiresAt,
        }
      );
    }

    // Check logical relationship between timestamps
    if (expiresAt <= issuedAt) {
      throw new TokenValidationError(
        "expiresAt must be greater than issuedAt",
        {
          issuedAt,
          expiresAt,
          difference: expiresAt - issuedAt,
        }
      );
    }

    // Check timestamp reasonableness
    const now = Date.now();
    const maxPastTime = now - 24 * 60 * 60 * 1000; // 24 hours ago
    const maxFutureTime = now + 365 * 24 * 60 * 60 * 1000; // 1 year ahead

    if (issuedAt < maxPastTime) {
      throw new TokenValidationError(
        "issuedAt is too far in the past (max 24 hours)",
        {
          issuedAt,
          maxPastTime,
          issuedAtDate: new Date(issuedAt).toISOString(),
        }
      );
    }

    if (expiresAt > maxFutureTime) {
      throw new TokenValidationError(
        "expiresAt is too far in the future (max 1 year)",
        {
          expiresAt,
          maxFutureTime,
          expiresAtDate: new Date(expiresAt).toISOString(),
        }
      );
    }
  }

  private async validateMeta(meta: any): Promise<void> {
    if (!meta) {
      throw new TokenValidationError("Meta object is required");
    }

    if (typeof meta !== "object" || Array.isArray(meta)) {
      throw new TokenValidationError("Meta must be an object", {
        receivedType: typeof meta,
        isArray: Array.isArray(meta),
      });
    }

    // Validate standard meta fields
    if (meta.deviceId !== undefined) {
      await this.validateDeviceId(meta.deviceId);
    }

    if (meta.ipAddress !== undefined) {
      await this.validateIpAddress(meta.ipAddress);
    }

    if (meta.userAgent !== undefined) {
      await this.validateUserAgent(meta.userAgent);
    }

    if (meta.fingerprint !== undefined) {
      await this.validateFingerprint(meta.fingerprint);
    }

    // Check meta object size
    const metaString = JSON.stringify(meta);
    if (metaString.length > 2048) {
      throw new TokenValidationError("Meta object too large (maximum 2KB)", {
        metaSize: metaString.length,
        maxSize: 2048,
      });
    }
  }

  private async validateDeviceId(deviceId: any): Promise<void> {
    if (typeof deviceId !== "string") {
      throw new TokenValidationError("deviceId must be a string", {
        receivedType: typeof deviceId,
      });
    }

    if (deviceId.trim().length === 0) {
      throw new TokenValidationError("deviceId cannot be empty");
    }

    if (deviceId.length > 128) {
      throw new TokenValidationError(
        "deviceId too long (maximum 128 characters)",
        {
          deviceIdLength: deviceId.length,
        }
      );
    }
  }

  private async validateIpAddress(ipAddress: any): Promise<void> {
    if (typeof ipAddress !== "string") {
      throw new TokenValidationError("ipAddress must be a string", {
        receivedType: typeof ipAddress,
      });
    }

    if (!this.isValidIpAddress(ipAddress)) {
      throw new TokenValidationError("Invalid IP address format", {
        ipAddress,
      });
    }
  }

  private async validateUserAgent(userAgent: any): Promise<void> {
    if (typeof userAgent !== "string") {
      throw new TokenValidationError("userAgent must be a string", {
        receivedType: typeof userAgent,
      });
    }

    if (userAgent.length > 512) {
      throw new TokenValidationError(
        "userAgent too long (maximum 512 characters)",
        {
          userAgentLength: userAgent.length,
        }
      );
    }
  }

  private async validateFingerprint(fingerprint: any): Promise<void> {
    if (typeof fingerprint !== "string") {
      throw new TokenValidationError("fingerprint must be a string", {
        receivedType: typeof fingerprint,
      });
    }

    if (fingerprint.length > 128) {
      throw new TokenValidationError(
        "fingerprint too long (maximum 128 characters)",
        {
          fingerprintLength: fingerprint.length,
        }
      );
    }
  }

  private async validateVersion(version: any): Promise<void> {
    if (typeof version !== "string") {
      throw new TokenValidationError("version must be a string", {
        receivedType: typeof version,
      });
    }

    if (version.length > 32) {
      throw new TokenValidationError(
        "version too long (maximum 32 characters)",
        {
          versionLength: version.length,
        }
      );
    }
  }

  private async validateTtl(ttl: any): Promise<void> {
    if (ttl === undefined || ttl === null) {
      throw new TokenValidationError("TTL is required");
    }

    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new TokenValidationError(
        "TTL must be a positive integer (seconds)",
        {
          receivedValue: ttl,
          receivedType: typeof ttl,
        }
      );
    }

    const maxTtl = 365 * 24 * 60 * 60; // 1 year in seconds
    if (ttl > maxTtl) {
      throw new TokenValidationError("TTL too large (maximum 1 year)", {
        ttl,
        maxTtl,
        ttlDays: Math.round(ttl / (24 * 60 * 60)),
      });
    }

    const minTtl = 60; // 1 minute
    if (ttl < minTtl) {
      throw new TokenValidationError("TTL too small (minimum 1 minute)", {
        ttl,
        minTtl,
      });
    }
  }

  private async validateStrict(request: TokenSaveRequest<T>): Promise<void> {
    const { token, data } = request;

    // Check for future timestamps first (most critical)
    const now = Date.now();
    if (data.issuedAt > now + 60000) {
      // 1 minute in the future
      throw new TokenValidationError("issuedAt cannot be in the future", {
        issuedAt: data.issuedAt,
        now,
        difference: data.issuedAt - now,
      });
    }

    // In strict mode require mandatory fields
    if (!data.meta.deviceId && !data.meta.ipAddress) {
      throw new TokenValidationError(
        "In strict mode, either deviceId or ipAddress is required in meta"
      );
    }

    // Additional token entropy check in strict mode
    if (!this.hasGoodEntropy(token)) {
      throw new TokenValidationError(
        "Token has insufficient entropy in strict mode",
        { token: token.substring(0, 8) + "..." }
      );
    }
  }

  private isValidIpAddress(ip: string): boolean {
    // IPv4 validation
    const ipv4Regex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    // IPv6 validation (simplified)
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;

    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }

  private hasGoodEntropy(token: string): boolean {
    // Simple entropy check - character diversity
    const uniqueChars = new Set(token).size;
    const minUniqueChars = Math.min(8, Math.floor(token.length * 0.5));

    return uniqueChars >= minUniqueChars;
  }
}

// ===================== STRICT VALIDATOR =====================

export class StrictTokenValidator<
  T extends ITokenMeta = ITokenMeta,
> extends DefaultTokenValidator<T> {
  constructor(config: TokenRegistryConfig) {
    super({ ...config, strictMode: true });
  }

  async validate(request: TokenSaveRequest<T>): Promise<void> {
    await super.validate(request);
    await this.validateStrictRequirements(request);
  }

  private async validateStrictRequirements(
    request: TokenSaveRequest<T>
  ): Promise<void> {
    const { data } = request;

    // Required fields in strict mode
    if (!data.meta.deviceId) {
      throw new TokenValidationError("deviceId is required in strict mode");
    }

    if (!data.meta.ipAddress) {
      throw new TokenValidationError("ipAddress is required in strict mode");
    }

    if (!data.meta.userAgent) {
      throw new TokenValidationError("userAgent is required in strict mode");
    }

    // Additional security checks
    await this.validateSecurityRequirements(request);
  }

  private async validateSecurityRequirements(
    request: TokenSaveRequest<T>
  ): Promise<void> {
    const { token, data } = request;

    // Check token length for strict security first
    if (token.length < 32) {
      throw new TokenValidationError("Token too short for strict mode", {
        tokenLength: token.length,
      });
    }

    // Check for suspicious IPs
    if (this.isSuspiciousIp(data.meta.ipAddress!)) {
      throw new TokenValidationError("Suspicious IP address detected", {
        ipAddress: data.meta.ipAddress,
      });
    }
  }

  private isSuspiciousIp(ip: string): boolean {
    // Simple checks for suspicious IPs
    const suspiciousPatterns = [
      /^127\./, // localhost
      /^10\./, // private network
      /^192\.168\./, // private network
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // private network
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(ip));
  }
}

// ===================== NO-OP VALIDATOR =====================

export class NoOpValidator<T extends ITokenMeta = ITokenMeta>
  implements ITokenValidator<T>
{
  async validate(_request: TokenSaveRequest<T>): Promise<void> {
    // No validation
  }
}
