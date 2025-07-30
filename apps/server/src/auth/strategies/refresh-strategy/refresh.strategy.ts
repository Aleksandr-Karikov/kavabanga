import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { FastifyRequest } from "fastify";
import { Strategy } from "passport-custom";
import { RefreshTokenStore } from "src/auth/refresh-token.store";
import { User } from "src/users/user.entity";
import { UsersService } from "src/users/users.service";

export interface RefreshUser {
  user: User;
  refreshToken: string;
  deviceId: string;
}

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
      throw new UnauthorizedException("Refresh token missing");
    }

    const tokenData = await this.tokenStore.get(refreshToken);
    if (!tokenData || tokenData.used) {
      throw new UnauthorizedException("Invalid or used refresh token");
    }

    const user = await this.usersService.findByUUID(tokenData.userId);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return { user, refreshToken, deviceId: tokenData.deviceId };
  }
}
