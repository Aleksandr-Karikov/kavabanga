import { Module, DynamicModule } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TokenValidator } from "./validator/token-validator";
import { RedisTokenRepository } from "./repository/redis-token-repository";
import { RefreshTokenStore } from "./refresh-token.store";
import { RefreshTokenStoreConfiguration } from "./refresh-token.types";
import { TokenCleanupService } from "./cleanup/token-cleanup.service";
import { TokenStatsService } from "./stats/token-stats.service";
import Redis from "ioredis";

export interface RefreshTokenModuleOptions {
  config: Partial<RefreshTokenStoreConfiguration>;
}

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RefreshTokenModule {
  static forRoot(options: RefreshTokenModuleOptions): DynamicModule {
    return {
      module: RefreshTokenModule,
      imports: [ScheduleModule.forRoot()],
      providers: [
        {
          provide: "REFRESH_TOKEN_STORE_CONFIG",
          useValue: options.config,
        },
        TokenValidator,
        {
          provide: RedisTokenRepository,
          useFactory: (redis: any, validator: TokenValidator) => {
            const config = validator.validateConfig(options.config);
            return new RedisTokenRepository(redis, config);
          },
          inject: ["default_IORedisModuleConnectionToken", TokenValidator],
        },
        {
          provide: TokenStatsService,
          useFactory: (
            repository: RedisTokenRepository,
            validator: TokenValidator
          ) => {
            const config = validator.validateConfig(options.config);
            return new TokenStatsService(repository, config);
          },
          inject: [RedisTokenRepository, TokenValidator],
        },
        {
          provide: TokenCleanupService,
          useFactory: (
            repository: RedisTokenRepository,
            validator: TokenValidator
          ) => {
            const config = validator.validateConfig(options.config);
            return new TokenCleanupService(repository, config);
          },
          inject: [RedisTokenRepository, TokenValidator],
        },
        RefreshTokenStore,
      ],
      exports: [
        RefreshTokenStore,
        TokenValidator,
        RedisTokenRepository,
        TokenStatsService,
        TokenCleanupService,
      ],
    };
  }

  static forRootAsync(options: {
    useFactory: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...args: any[]
    ) => Promise<RefreshTokenModuleOptions> | RefreshTokenModuleOptions;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inject?: any[];
  }): DynamicModule {
    return {
      module: RefreshTokenModule,
      imports: [ScheduleModule.forRoot()],
      providers: [
        {
          provide: "REFRESH_TOKEN_STORE_CONFIG",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useFactory: async (...args: any[]) => {
            const moduleOptions = await options.useFactory(...args);
            return moduleOptions.config;
          },
          inject: options.inject || [],
        },
        TokenValidator,
        {
          provide: RedisTokenRepository,
          useFactory: async (
            redis: Redis,
            validator: TokenValidator,
            config: RefreshTokenStoreConfiguration
          ) => {
            const validatedConfig = validator.validateConfig(config);
            return new RedisTokenRepository(redis, validatedConfig);
          },
          inject: [
            "default_IORedisModuleConnectionToken",
            TokenValidator,
            "REFRESH_TOKEN_STORE_CONFIG",
          ],
        },
        {
          provide: TokenStatsService,
          useFactory: async (
            repository: RedisTokenRepository,
            validator: TokenValidator,
            config: RefreshTokenStoreConfiguration
          ) => {
            const validatedConfig = validator.validateConfig(config);
            return new TokenStatsService(repository, validatedConfig);
          },
          inject: [
            RedisTokenRepository,
            TokenValidator,
            "REFRESH_TOKEN_STORE_CONFIG",
          ],
        },
        {
          provide: TokenCleanupService,
          useFactory: async (
            repository: RedisTokenRepository,
            validator: TokenValidator,
            config: RefreshTokenStoreConfiguration
          ) => {
            const validatedConfig = validator.validateConfig(config);
            return new TokenCleanupService(repository, validatedConfig);
          },
          inject: [
            RedisTokenRepository,
            TokenValidator,
            "REFRESH_TOKEN_STORE_CONFIG",
          ],
        },
        RefreshTokenStore,
      ],
      exports: [
        RefreshTokenStore,
        TokenValidator,
        RedisTokenRepository,
        TokenStatsService,
        TokenCleanupService,
      ],
    };
  }
}
