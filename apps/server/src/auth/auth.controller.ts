import { FastifyReply } from "fastify";
import { AuthService } from "./auth.service";
import {
  Controller,
  Get,
  Post,
  UseGuards,
  Res,
  Req,
  HttpStatus,
} from "@nestjs/common";
import { JwtAuthGuard } from "./strategies/access-jwt-strategy/jwt-auth.guard";
import { LocalAuthGuard } from "./strategies/local-strategy/local-auth.guard";
import { RefreshJwtAuthGuard } from "./strategies/refresh-jwt-strategy/refresh-jwt.guard";
import { User } from "src/users/user.entity";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
@Controller("auth")
export class AuthController {
  private readonly REFRESH_COOKIE_NAME = "refreshToken";
  constructor(private authService: AuthService) {}

  private async setRefreshTokenToCookie(
    res: FastifyReply,
    refreshToken: string
  ) {
    res.setCookie(this.REFRESH_COOKIE_NAME, refreshToken, {
      maxAge: 7 * 24 * 60 * 60,
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
    try {
      const { accessToken, refreshToken } = await this.authService.login(
        req.user
      );
      await this.setRefreshTokenToCookie(res, refreshToken);
      res.send({ accessToken });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
        message: "Login failed",
        error: message,
      });
    }
  }

  @Post("refresh")
  @UseGuards(RefreshJwtAuthGuard)
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
  async refresh(@Req() req: { user: User }, @Res() res: FastifyReply) {
    try {
      const { accessToken, refreshToken } = await this.authService.login(
        req.user
      );
      await this.setRefreshTokenToCookie(res, refreshToken);
      res.send({ accessToken });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
        message: "Refresh failed",
        error: message,
      });
    }
  }

  @UseGuards(RefreshJwtAuthGuard)
  @Post("logout")
  async logout(@Res() res: FastifyReply) {
    res.clearCookie(this.REFRESH_COOKIE_NAME);
  }

  @UseGuards(JwtAuthGuard)
  @Get("profile")
  @ApiBearerAuth()
  getProfile(@Req() req) {
    return req.user;
  }
}
