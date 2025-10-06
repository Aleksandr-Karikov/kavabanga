import { TokenData, TokenEventHandler } from "@kavabanga/token-registry-nest";
import { Logger, LoggerService } from "@nestjs/common";

export class RefreshTokenEventHandlers implements TokenEventHandler {
  private readonly logger: LoggerService = new Logger(
    RefreshTokenEventHandlers.name
  );

  async onTokenCreated(token: string, data: TokenData): Promise<void> {
    this.logger.debug(
      `[RefreshTokenEventHandlers] Token created: ${token}`,
      data
    );
  }

  async onTokenAccessed(token: string, data: TokenData): Promise<void> {
    this.logger.debug(
      `[RefreshTokenEventHandlers] Token accessed: ${token}`,
      data
    );
  }

  async onTokenRevoked(token: string, data: TokenData): Promise<void> {
    this.logger.debug(
      `[RefreshTokenEventHandlers] Token revoked: ${token}`,
      data
    );
  }
}
