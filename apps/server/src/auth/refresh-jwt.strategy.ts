import { AuthService } from "src/auth/auth.service";
import { Strategy } from "passport-jwt";
import { PassportStrategy } from "@nestjs/passport";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RefreshTokenPayload } from "src/auth/auth.types";

@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService
  ) {
    super({
      jwtFromRequest: (req) => req.cookies?.refreshToken,
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_REFRESH_SECRET"),
    });
  }

  async validate(payload: RefreshTokenPayload) {
    if (!payload || !payload.refresh) throw new UnauthorizedException();
    return this.authService.validateUserByUserName(payload.username);
  }
}
