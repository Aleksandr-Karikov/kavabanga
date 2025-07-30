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
import { ACCESS_TOKEN_TTL_MINUTE } from "src/auth/auth.constants";

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => {
        return {
          secret: configService.get<string>("JWT_ACCESS_SECRET"),
          signOptions: {
            expiresIn: `${ACCESS_TOKEN_TTL_MINUTE}m`,
          },
        };
      },
    }),
  ],
  providers: [AuthService, LocalStrategy, JwtStrategy, RefreshStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
