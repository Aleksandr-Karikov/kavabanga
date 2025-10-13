import {
  ITokenValidator,
  ITokenMeta,
  TokenData,
  TokenValidationError,
  TokenRegistryConfig,
} from "./interfaces";

export class DefaultTokenValidator<T extends ITokenMeta = ITokenMeta>
  implements ITokenValidator<T>
{
  constructor(private readonly config: TokenRegistryConfig) {}

  async validate(
    token: string,
    data: TokenData<T>,
    ttl: number
  ): Promise<void> {
    // Validate token format
    this.validateToken(token);

    // Validate token data structure
    this.validateTokenData(data);

    // Validate TTL
    this.validateTtl(ttl);
  }

  private validateToken(token: string): void {
    if (!token || typeof token !== "string") {
      throw new TokenValidationError("Token must be a non-empty string");
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
  }

  private validateTokenData(data: any): void {
    if (!data || typeof data !== "object") {
      throw new TokenValidationError("Token data must be an object");
    }

    // Validate required fields
    this.validateSubject(data.sub);
    this.validateTimestamps(data.issuedAt, data.expiresAt);
    this.validateMeta(data.meta);

    // Validate optional version
    if (data.version !== undefined) {
      this.validateVersion(data.version);
    }
  }

  private validateSubject(sub: any): void {
    if (!sub || typeof sub !== "string") {
      throw new TokenValidationError(
        "Subject (sub) must be a non-empty string"
      );
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

  private validateTimestamps(issuedAt: any, expiresAt: any): void {
    // Validate issuedAt
    if (!Number.isInteger(issuedAt) || issuedAt <= 0) {
      throw new TokenValidationError(
        "issuedAt must be a positive integer timestamp"
      );
    }

    // Validate expiresAt
    if (!Number.isInteger(expiresAt) || expiresAt <= 0) {
      throw new TokenValidationError(
        "expiresAt must be a positive integer timestamp"
      );
    }

    // Check logical relationship
    if (expiresAt <= issuedAt) {
      throw new TokenValidationError("expiresAt must be greater than issuedAt");
    }

    // Check timestamp reasonableness
    const now = Date.now();
    const maxPastTime = now - 24 * 60 * 60 * 1000; // 24 hours ago
    const maxFutureTime = now + 365 * 24 * 60 * 60 * 1000; // 1 year ahead

    if (issuedAt < maxPastTime) {
      throw new TokenValidationError(
        "issuedAt is too far in the past (max 24 hours)"
      );
    }

    if (expiresAt > maxFutureTime) {
      throw new TokenValidationError(
        "expiresAt is too far in the future (max 1 year)"
      );
    }
  }

  private validateMeta(meta: any): void {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      throw new TokenValidationError("Meta must be an object");
    }

    // Validate standard meta fields if present
    if (meta.deviceId !== undefined) {
      this.validateDeviceId(meta.deviceId);
    }

    if (meta.ipAddress !== undefined) {
      this.validateIpAddress(meta.ipAddress);
    }

    if (meta.userAgent !== undefined) {
      this.validateUserAgent(meta.userAgent);
    }

    if (meta.fingerprint !== undefined) {
      this.validateFingerprint(meta.fingerprint);
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

  private validateDeviceId(deviceId: any): void {
    if (typeof deviceId !== "string") {
      throw new TokenValidationError("deviceId must be a string");
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

  private validateIpAddress(ipAddress: any): void {
    if (typeof ipAddress !== "string") {
      throw new TokenValidationError("ipAddress must be a string");
    }

    if (!this.isValidIpAddress(ipAddress)) {
      throw new TokenValidationError("Invalid IP address format", {
        ipAddress,
      });
    }
  }

  private validateUserAgent(userAgent: any): void {
    if (typeof userAgent !== "string") {
      throw new TokenValidationError("userAgent must be a string");
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

  private validateFingerprint(fingerprint: any): void {
    if (typeof fingerprint !== "string") {
      throw new TokenValidationError("fingerprint must be a string");
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

  private validateVersion(version: any): void {
    if (typeof version !== "string") {
      throw new TokenValidationError("version must be a string");
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

  private validateTtl(ttl: any): void {
    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new TokenValidationError(
        "TTL must be a positive integer (seconds)"
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

  private isValidIpAddress(ip: string): boolean {
    // IPv4 validation
    const ipv4Regex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    // IPv6 validation (simplified)
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;

    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }
}

export class NoOpValidator<T extends ITokenMeta = ITokenMeta>
  implements ITokenValidator<T>
{
  async validate(
    _token: string,
    _data: TokenData<T>,
    _ttl: number
  ): Promise<void> {}
}
