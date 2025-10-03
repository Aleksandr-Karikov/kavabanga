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
import { TokenRegistryModule } from "@kavabanga/token-registry-nest";
import { createIoredisStore, Redis } from "@kavabanga/token-registry-ioredis";

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
    TokenRegistryModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        storeFactory: () => {
          const redis = new Redis(configService.get<string>("REDIS_URL"));
          return createIoredisStore(redis, {
            keyPrefix: configService.get<string>("REFRESH_TOKEN_STORE_PREFIX", "tokens"),
          });
        },
        config: {
          defaultTtl: configService.get<number>("REFRESH_TOKEN_TTL", 30 * 24 * 60 * 60),
          enableValidation: configService.get<boolean>(
            "TOKEN_VALIDATION_ENABLED",
            true
          ),
          enableEvents: configService.get<boolean>("TOKEN_EVENTS_ENABLED", true),
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [AuthService, LocalStrategy, JwtStrategy, RefreshStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
