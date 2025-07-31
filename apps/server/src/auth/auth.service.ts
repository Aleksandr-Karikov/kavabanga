import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { User } from "src/users/user.entity";
import { UsersService } from "src/users/users.service";
import * as bcrypt from "bcrypt";
import { v7 } from "uuid";
import { RefreshTokenStore } from "src/auth/refresh-token.store";
import crypto from "crypto";
@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private tokenStore: RefreshTokenStore
  ) {}

  async validateUserPassword(
    username: string,
    pass: string
  ): Promise<Omit<User, "password">> {
    const user = await this.usersService.findByUsername(username);

    if (!user || !bcrypt.compareSync(pass, user.password)) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...result } = user;
    return result;
  }

  async validateUserByUserName(userName: string): Promise<User | null> {
    return this.usersService.findByUsername(userName) ?? null;
  }

  async refreshToken(
    oldToken: string,
    user: User,
    deviceId?: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    await this.tokenStore.markUsed(oldToken, user.uuid);

    return this.login(user, deviceId);
  }

  async logout(refreshToken: string, userUuid: User["uuid"]) {
    await this.tokenStore.delete(refreshToken, userUuid);
  }

  async login(user: User, deviceId?: string) {
    const payload = { username: user.username, sub: user.uuid };
    const accessToken = this.jwtService.sign(payload);

    const refreshToken = crypto.randomBytes(32).toString("hex");
    const resolvedDeviceId = deviceId ?? v7();

    await this.tokenStore.save(refreshToken, {
      userId: user.uuid,
      deviceId: resolvedDeviceId,
    });

    return {
      accessToken,
      refreshToken,
    };
  }
}
