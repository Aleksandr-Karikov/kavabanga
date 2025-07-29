import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UsersModule } from "src/users/users.module";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { JwtStrategy } from "./jwt.strategy";
import { LocalStrategy } from "./local.strategy";
import { RefreshJwtStrategy } from "src/auth/refresh-jwt.strategy";

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  providers: [AuthService, LocalStrategy, JwtStrategy, RefreshJwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AuthModule {}
