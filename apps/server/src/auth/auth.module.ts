import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UsersModule } from "src/users/users.module";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { JwtStrategy } from "./strategies/access-jwt-strategy/jwt.strategy";
import { LocalStrategy } from "./strategies/local-strategy/local.strategy";
import { RefreshStrategy } from "./strategies/refresh-strategy/refresh.strategy";
import { ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { RefreshTokenStore } from "src/auth/refresh-token-store/refresh-token.store";
import Redis from "ioredis";

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => {
        return {
          secret: configService.get<string>("JWT_ACCESS_SECRET"),
          signOptions: {
            expiresIn: `${configService.get<number>("ACCESS_TOKEN_TTL_MINUTE")}m`,
          },
        };
      },
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    RefreshTokenStore,
    {
      provide: "REFRESH_TOKEN_STORE_CONFIG",
      useFactory: (configService: ConfigService) => ({
        ttl: configService.get<number>("REFRESH_TOKEN_TTL", 604800),
        usedTokenTtl: configService.get<number>("USED_TOKEN_TTL", 300),
        refreshTokenRedisPrefix: configService.get<string>(
          "REFRESH_TOKEN_PREFIX",
          "refresh"
        ),
        userTokensSetRedisPrefix: configService.get<string>(
          "USER_TOKENS_PREFIX",
          "user_tokens"
        ),
        maxTokenLength: configService.get<number>("MAX_TOKEN_LENGTH", 255),
        maxDevicesPerUser: configService.get<number>(
          "MAX_DEVICES_PER_USER",
          10
        ),
        maxBatchSize: configService.get<number>("MAX_BATCH_SIZE", 300),
        enableScheduledCleanup: configService.get<boolean>(
          "ENABLE_TOKEN_CLEANUP",
          true
        ),
      }),
      inject: [ConfigService],
    },
    AuthService,
    LocalStrategy,
    JwtStrategy,
    RefreshStrategy,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
