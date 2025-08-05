import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { FastifyRequest } from "fastify";
import { Strategy } from "passport-custom";
import { RefreshUser } from "src/auth/auth.types";
import { RefreshTokenStore } from "src/auth/refresh-token/refresh-token.store";
import { UsersService } from "src/users/users.service";

@Injectable()
export class RefreshStrategy extends PassportStrategy(
  Strategy,
  "refresh-token"
) {
  constructor(
    private readonly tokenStore: RefreshTokenStore,
    private readonly usersService: UsersService
  ) {
    super();
  }

  async validate(req: FastifyRequest): Promise<RefreshUser> {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException({
        error: "MissingRefreshToken",
        message: "Refresh token is required",
      });
    }

    const tokenData = await this.tokenStore.getTokenData(refreshToken);

    if (!tokenData) {
      throw new UnauthorizedException({
        error: "InvalidRefreshToken",
        message: "Token not found",
      });
    }

    if (tokenData.used) {
      throw new UnauthorizedException({
        error: "UsedRefreshToken",
        message: "Token was already used",
      });
    }

    const user = await this.usersService.findByUUID(tokenData.userId);

    if (!user) {
      throw new UnauthorizedException({
        error: "UserNotFound",
        message: "User associated with token does not exist",
      });
    }

    return { user, refreshToken, deviceId: tokenData.deviceId };
  }
}
