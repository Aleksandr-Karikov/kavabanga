import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { User } from "src/users/user.entity";
import { UsersService } from "src/users/users.service";
import * as bcrypt from "bcrypt";
@Injectable()
export class AuthService {
  private accessSecret: string;
  private refreshSecret: string;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    configService: ConfigService
  ) {
    this.accessSecret = configService.get<string>("JWT_ACCESS_SECRET");
    this.refreshSecret = configService.get<string>("JWT_REFRESH_SECRET");
  }

  async validateUserPassword(
    username: string,
    pass: string
  ): Promise<Omit<User, "password">> {
    const user = await this.usersService.findOne(username);
    if (user) {
      const isCorrectPassword = bcrypt.compareSync(pass, user.password);
      if (isCorrectPassword) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...result } = user;
        return result;
      } else {
        return null;
      }
    }
    return null;
  }

  async validateUserByUserName(userName: string): Promise<User | null> {
    return this.usersService.findOne(userName) ?? null;
  }

  async login(
    user: User
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = { username: user.username, sub: user.uuid };
    return {
      accessToken: this.jwtService.sign(payload, {
        expiresIn: "15m",
        secret: this.accessSecret,
      }),
      refreshToken: this.jwtService.sign(
        { ...payload, refresh: true },
        {
          secret: this.refreshSecret,
          expiresIn: "7d",
        }
      ),
    };
  }
}
