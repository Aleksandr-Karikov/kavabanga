import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { RefreshTokenStoreConfiguration } from "../refresh-token.types";
import { TOKEN_REPOSITORY } from "src/auth/refresh-token/refresh-token.symbols";
import { ITokenRepository } from "src/auth/refresh-token/repository/token-repository.interface";

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);
  private lastCleanupTime: Date | null = null;

  constructor(
    @Inject(TOKEN_REPOSITORY)
    private readonly repository: ITokenRepository,
    private readonly configuration: RefreshTokenStoreConfiguration
  ) {}

  /**
   * Scheduled cleanup job - runs every hour at minute 0
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: "refresh-token-cleanup",
    timeZone: "UTC",
  })
  async scheduledCleanup(): Promise<void> {
    if (!this.configuration.enableScheduledCleanup) {
      this.logger.debug("Global cleanup is disabled by configuration");
      return;
    }

    this.logger.debug("Starting scheduled token cleanup...");

    try {
      const cleanedCount = await this.performGlobalCleanup();
      this.lastCleanupTime = new Date();

      if (cleanedCount > 0) {
        this.logger.log(
          `Scheduled cleanup completed: ${cleanedCount} expired tokens removed`
        );
      } else {
        this.logger.debug(
          "Scheduled cleanup completed: no expired tokens found"
        );
      }
    } catch (error) {
      this.logger.error("Scheduled cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Performs global cleanup of expired/invalid tokens across all users
   */
  async performGlobalCleanup(): Promise<number> {
    let totalCleaned = 0;
    let cursor = "0";
    const batchSize = 100;

    this.logger.debug("Starting global token cleanup...");

    do {
      const [nextCursor, keys] = await this.repository.scanUserTokenKeys(
        cursor,
        batchSize
      );
      cursor = nextCursor;

      this.logger.debug(`Processing batch with ${keys.length} user token sets`);

      for (const userTokensKey of keys) {
        try {
          const userId = userTokensKey.split(":").pop();

          if (!userId) continue;

          this.logger.debug(`Cleaning tokens for user ${userId}`);
          const cleaned =
            await this.repository.cleanupUserExpiredTokens(userId);
          totalCleaned += cleaned ?? 0;

          this.logger.debug(`Cleaned ${cleaned} tokens for user ${userId}`);
        } catch (error) {
          this.logger.error(`Cleanup failed for ${userTokensKey}`, error);
        }
      }
    } while (cursor !== "0");

    this.logger.debug(
      `Global cleanup completed. Total tokens cleaned: ${totalCleaned}`
    );
    return totalCleaned;
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(): Promise<{
    isScheduledCleanupEnabled: boolean;
    lastCleanupTime?: Date;
    estimatedExpiredTokens: number;
  }> {
    return {
      isScheduledCleanupEnabled: this.configuration.enableScheduledCleanup,
      lastCleanupTime: this.lastCleanupTime || undefined,
      estimatedExpiredTokens: 0,
    };
  }
}
