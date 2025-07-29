import { FastifyReply } from "fastify";
import { AuthService } from "./auth.service";
import {
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
  Res,
  Req,
} from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { LocalAuthGuard } from "./local-auth.guard";
import { fastifyCookie } from "@fastify/cookie";
import { User } from "src/users/user.entity";
import { RefreshJwtAuthGuard } from "src/auth/refresh-jwt.guard";
@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  private async setRefreshTokenToCookie(
    res: FastifyReply,
    refreshToken: string
  ) {
    const cookie = fastifyCookie.serialize("refreshToken", refreshToken, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "strict",
    });

    res.header("Set-Cookie", cookie);
  }

  @UseGuards(LocalAuthGuard)
  @Post("login")
  async login(@Request() req, @Res() res: FastifyReply) {
    const { accessToken, refreshToken } = await this.authService.login(
      req.user
    );

    await this.setRefreshTokenToCookie(res, refreshToken);

    return { accessToken };
  }

  @Post("refresh")
  @UseGuards(RefreshJwtAuthGuard)
  async refresh(@Req() req: { user: User }, @Res() res: FastifyReply) {
    const { accessToken, refreshToken } = await this.authService.login(
      req.user
    );

    await this.setRefreshTokenToCookie(res, refreshToken);

    return { accessToken };
  }

  @UseGuards(LocalAuthGuard)
  @Post("logout")
  async logout(@Request() req) {
    return req.logout();
  }

  @UseGuards(JwtAuthGuard)
  @Get("profile")
  getProfile(@Request() req) {
    return req.user;
  }
}
