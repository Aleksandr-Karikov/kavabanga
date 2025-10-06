import { FastifyReply, FastifyRequest } from "fastify";
import { AuthService } from "./auth.service";
import {
  Controller,
  Get,
  Post,
  UseGuards,
  Res,
  Req,
  LoggerService,
  Logger,
} from "@nestjs/common";
import { JwtAuthGuard } from "./strategies/access-jwt-strategy/jwt-auth.guard";
import { LocalAuthGuard } from "./strategies/local-strategy/local-auth.guard";
import { RefreshAuthGuard } from "./strategies/refresh-strategy/refresh.guard";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { RefreshUser } from "./auth.types";
import { ConfigService } from "@nestjs/config";

@Controller("auth")
export class AuthController {
  private readonly REFRESH_COOKIE_NAME = "refreshToken";
  private readonly REFRESH_TOKEN_TTL_SECONDS;
  private readonly logger: LoggerService = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    configService: ConfigService
  ) {
    this.REFRESH_TOKEN_TTL_SECONDS = configService.get<number>(
      "REFRESH_TOKEN_TTL_SECONDS"
    );
  }

  private async setRefreshTokenToCookie(
    res: FastifyReply,
    refreshToken: string
  ) {
    this.logger.debug(
      `Set refresh cookie with maxAta: ${this.REFRESH_TOKEN_TTL_SECONDS}`
    );
    res.setCookie(this.REFRESH_COOKIE_NAME, refreshToken, {
      maxAge: this.REFRESH_TOKEN_TTL_SECONDS,
      httpOnly: true,
      sameSite: "strict",
    });
  }

  @UseGuards(LocalAuthGuard)
  @Post("login")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        username: {
          type: "string",
        },
        password: {
          type: "string",
        },
      },
    },
  })
  @ApiOperation({
    summary: "Login",
    description: "Authenticates user and sets an HTTP-only cookie with JWT.",
  })
  @ApiResponse({
    status: 200,
    description: "Successful login",
    headers: {
      "Set-Cookie": {
        description: "Sets an HTTP-only cookie with the JWT refresh token",
        schema: {
          type: "string",
          example:
            "refreshToken=abcde12345; Path=/; HttpOnly; Secure; SameSite=Strict",
        },
      },
    },
    schema: {
      type: "object",
      properties: {
        accessToken: { type: "string" },
      },
    },
  })
  async login(@Req() req, @Res() res: FastifyReply) {
    const deviceId = req.headers["x-device-id"] || "default-device";
    const { accessToken, refreshToken } = await this.authService.login(
      req.user,
      deviceId
    );

    await this.setRefreshTokenToCookie(res, refreshToken);
    res.send({ accessToken });
  }

  @UseGuards(RefreshAuthGuard)
  @Post("refresh")
  @ApiOperation({
    summary: "Refresh access token",
    description: "Refresh access token and sets an HTTP-only cookie with JWT.",
  })
  @ApiResponse({
    status: 200,
    description: "Successful refresh",
    headers: {
      "Set-Cookie": {
        description: "Sets an HTTP-only cookie with the JWT refresh token",
        schema: {
          type: "string",
          example:
            "refreshToken=abcde12345; Path=/; HttpOnly; Secure; SameSite=Strict",
        },
      },
    },
    schema: {
      type: "object",
      properties: {
        accessToken: { type: "string" },
      },
    },
  })
  async refresh(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-expect-error
    const { user, refreshToken: oldToken, deviceId } = req.user as RefreshUser;

    const { accessToken, refreshToken } = await this.authService.refreshToken(
      oldToken,
      user,
      deviceId
    );

    await this.setRefreshTokenToCookie(res, refreshToken);
    res.send({ accessToken });
  }

  @UseGuards(RefreshAuthGuard)
  @Post("logout")
  async logout(@Req() req, @Res() res: FastifyReply) {
    const refreshToken = req.cookies?.[this.REFRESH_COOKIE_NAME];
    try {
      if (refreshToken) await this.authService.logout(refreshToken);
    } catch (e) {
      this.logger.error(`Logout failed: ${e.message}`, e.stack);
    } finally {
      res.clearCookie(this.REFRESH_COOKIE_NAME);
      res.send({ ok: true });
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get("profile")
  @ApiBearerAuth()
  getProfile(@Req() req) {
    return req.user;
  }
}
