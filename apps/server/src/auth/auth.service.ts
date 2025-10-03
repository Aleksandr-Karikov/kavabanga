import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { User } from "src/users/user.entity";
import { UsersService } from "src/users/users.service";
import * as bcrypt from "bcrypt";
import { v7 } from "uuid";
import crypto from "crypto";
import {
  InjectTokenRegistry,
  TokenRegistryService,
} from "@kavabanga/token-registry-nest";

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectTokenRegistry()
    private readonly tokenRegistry: TokenRegistryService
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
    await this.tokenRegistry.revokeToken(oldToken);

    return this.login(user, deviceId);
  }

  async logout(refreshToken: string) {
    await this.tokenRegistry.revokeToken(refreshToken);
  }

  async login(user: User, deviceId?: string) {
    const payload = { username: user.username, sub: user.uuid };
    const accessToken = this.jwtService.sign(payload);

    const refreshToken = crypto.randomBytes(32).toString("hex");
    const resolvedDeviceId = deviceId ?? v7();

    await this.tokenRegistry.saveToken(refreshToken, {
      sub: user.uuid,
      meta: {
        deviceId: resolvedDeviceId,
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }
}
