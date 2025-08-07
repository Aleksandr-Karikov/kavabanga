// src/auth/refresh-token/refresh-token.module.ts
import {
  Module,
  DynamicModule,
  OptionalFactoryDependency,
  InjectionToken,
} from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { TokenValidator } from "./validator/token-validator";
import { RedisTokenRepository } from "./repository/redis-token-repository";
import { RefreshTokenStore } from "./refresh-token.store";
import { RefreshTokenStoreConfiguration } from "./refresh-token.types";
import { TokenCleanupService } from "./cleanup/token-cleanup.service";
import { TokenStatsService } from "./stats/token-stats.service";
import Redis from "ioredis";
import { ITokenRepository } from "./repository/token-repository.interface";
import { ResilientTokenRepository } from "./repository/resilient-redis-token-repository";
import { CircuitBreakerModule } from "src/common/circuit-breaker.module";
import { CircuitBreakerManager } from "src/common/circuit-breaker.manager";
import { TokenErrorClassifier } from "src/auth/refresh-token/token-error-classifier";
import { TOKEN_REPOSITORY } from "src/auth/refresh-token/refresh-token.symbols";

export interface RefreshTokenModuleOptions {
  config: Partial<RefreshTokenStoreConfiguration>;
  enabledCircuitBreaker: boolean;
}

@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RefreshTokenModule {
  static forRoot(options: RefreshTokenModuleOptions): DynamicModule {
    return {
      module: RefreshTokenModule,
      imports: [
        ScheduleModule.forRoot(),
        CircuitBreakerModule.forRoot(TokenErrorClassifier),
      ],
      providers: [
        {
          provide: "REFRESH_TOKEN_STORE_CONFIG",
          useValue: options.config,
        },
        TokenValidator,
        {
          provide: TOKEN_REPOSITORY,
          useFactory: (
            redis: Redis,
            validator: TokenValidator,
            circuitBreakerManager: CircuitBreakerManager
          ) => {
            const config = validator.validateConfig(options.config);
            const redisRepo = new RedisTokenRepository(redis, config);
            return options.enabledCircuitBreaker
              ? new ResilientTokenRepository(redisRepo, circuitBreakerManager)
              : redisRepo;
          },
          inject: [
            "default_IORedisModuleConnectionToken",
            TokenValidator,
            CircuitBreakerManager,
          ],
        },
        {
          provide: TokenStatsService,
          useFactory: (
            repository: ITokenRepository,
            validator: TokenValidator
          ) => {
            const config = validator.validateConfig(options.config);
            return new TokenStatsService(repository, config);
          },
          inject: [TOKEN_REPOSITORY, TokenValidator],
        },
        {
          provide: TokenCleanupService,
          useFactory: (
            repository: ITokenRepository,
            validator: TokenValidator
          ) => {
            const config = validator.validateConfig(options.config);
            return new TokenCleanupService(repository, config);
          },
          inject: [TOKEN_REPOSITORY, TokenValidator],
        },
        RefreshTokenStore,
      ],
      exports: [RefreshTokenStore],
    };
  }

  static forRootAsync(options: {
    useFactory: (
      ...args: unknown[]
    ) => Promise<RefreshTokenModuleOptions> | RefreshTokenModuleOptions;
    inject?: (InjectionToken | OptionalFactoryDependency)[];
  }): DynamicModule {
    return {
      module: RefreshTokenModule,
      imports: [
        ScheduleModule.forRoot(),
        CircuitBreakerModule.forRoot(TokenErrorClassifier),
      ],
      providers: [
        {
          provide: "REFRESH_TOKEN_STORE_CONFIG",
          useFactory: async (...args: unknown[]) => {
            const moduleOptions = await options.useFactory(...args);
            return moduleOptions.config;
          },
          inject: options.inject || [],
        },
        TokenValidator,
        {
          provide: TOKEN_REPOSITORY,
          useFactory: async (
            redis: Redis,
            validator: TokenValidator,
            circuitBreakerManager: CircuitBreakerManager,
            config: RefreshTokenStoreConfiguration
          ) => {
            const validatedConfig = validator.validateConfig(config);
            const redisRepo = new RedisTokenRepository(redis, validatedConfig);
            return redisRepo;
          },
          inject: [
            "default_IORedisModuleConnectionToken",
            TokenValidator,
            CircuitBreakerManager,
            "REFRESH_TOKEN_STORE_CONFIG",
          ],
        },
        {
          provide: TokenStatsService,
          useFactory: async (
            repository: ITokenRepository,
            validator: TokenValidator,
            config: RefreshTokenStoreConfiguration
          ) => {
            const validatedConfig = validator.validateConfig(config);
            return new TokenStatsService(repository, validatedConfig);
          },
          inject: [
            TOKEN_REPOSITORY,
            TokenValidator,
            "REFRESH_TOKEN_STORE_CONFIG",
          ],
        },
        {
          provide: TokenCleanupService,
          useFactory: async (
            repository: ITokenRepository,
            validator: TokenValidator,
            config: RefreshTokenStoreConfiguration
          ) => {
            const validatedConfig = validator.validateConfig(config);
            return new TokenCleanupService(repository, validatedConfig);
          },
          inject: [
            TOKEN_REPOSITORY,
            TokenValidator,
            "REFRESH_TOKEN_STORE_CONFIG",
          ],
        },
        RefreshTokenStore,
      ],
      exports: [RefreshTokenStore],
    };
  }
}
