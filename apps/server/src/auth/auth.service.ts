import {
  Injectable,
  InternalServerErrorException,
  Logger,
  LoggerService,
} from "@nestjs/common";
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
import { AccessTokenPayload } from "src/auth/auth.types";

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectTokenRegistry()
    private readonly tokenRegistry: TokenRegistryService
  ) {}

  private readonly logger: LoggerService = new Logger(AuthService.name);

  async validateUserPassword(
    username: string,
    pass: string
  ): Promise<User | null> {
    try {
      const user = await this.usersService.findByUsername(username);

      if (!user) {
        this.logger.debug(`User not found: ${username}`);
        return null;
      }

      if (!user.isActive) {
        this.logger.debug(`User is inactive: ${username}`);
        return null;
      }

      const isPasswordValid = await bcrypt.compare(pass, user.password);
      if (!isPasswordValid) {
        this.logger.debug(`Invalid password for user: ${username}`);
        return null;
      }

      return user;
    } catch (error) {
      this.logger.error(`Failed to validate user password for: ${username}`, {
        error: error.message,
      });
      throw new InternalServerErrorException(
        "Authentication service unavailable"
      );
    }
  }

  async validateUserByUserName(userName: string): Promise<User | null> {
    try {
      const user = await this.usersService.findByUsername(userName);
      if (!user) {
        this.logger.debug(`User not found by username: ${userName}`);
      }
      return user ?? null;
    } catch (error) {
      this.logger.error(`Failed to find user by username: ${userName}`, {
        error: error.message,
      });
      throw new InternalServerErrorException("User lookup service unavailable");
    }
  }

  async refreshToken(
    oldToken: string,
    user: User,
    deviceId?: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      await this.tokenRegistry.revokeToken(oldToken);
      this.logger.debug(`Token revoked successfully for user: ${user.uuid}`);
    } catch (error) {
      this.logger.warn(`Failed to revoke old token for user: ${user.uuid}`, {
        error: error.message,
      });
    }

    try {
      const result = await this.login(user, deviceId);
      this.logger.debug(`Token refreshed successfully for user: ${user.uuid}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to refresh token for user: ${user.uuid}`, {
        error: error.message,
        deviceId,
      });
      throw new InternalServerErrorException("Failed to refresh session");
    }
  }

  async logout(refreshToken: string): Promise<void> {
    if (!refreshToken) {
      this.logger.warn("Attempt to logout with empty refresh token");
      return;
    }

    try {
      await this.tokenRegistry.revokeToken(refreshToken);
      this.logger.debug("User logged out successfully");
    } catch (error) {
      this.logger.warn(
        "Failed to revoke token during logout (Redis may be down)",
        {
          error: error.message,
          tokenPrefix: refreshToken.substring(0, 10) + "...",
        }
      );
    }
  }

  async login(
    user: User,
    deviceId?: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload: AccessTokenPayload = {
        username: user.username,
        sub: user.uuid,
        roles: user.roles?.map((role) => role.name) ?? [],
        permissions: this.getUserPermissions(user),
      };

      const accessToken = this.jwtService.sign(payload);
      const refreshToken = crypto.randomBytes(32).toString("hex");
      const resolvedDeviceId = deviceId ?? v7();

      try {
        await this.tokenRegistry.saveToken(refreshToken, {
          sub: user.uuid,
          meta: {
            deviceId: resolvedDeviceId,
            roles: payload.roles,
          },
          issuedAt: Date.now(),
        });
      } catch (error) {
        this.logger.warn(
          `Failed to save token to Redis for user: ${user.uuid}`,
          {
            error: error.message,
          }
        );
      }

      this.logger.log(`User logged in successfully: ${user.uuid}`);
      return { accessToken, refreshToken };
    } catch (error) {
      this.logger.error(`Login failed for user: ${user.uuid}`, {
        error: error instanceof Error ? error.message : String(error),
        deviceId,
        userId: user.uuid,
      });

      throw new InternalServerErrorException(
        "Authentication service temporarily unavailable"
      );
    }
  }

  private getUserPermissions(user: User): string[] {
    const permissions = new Set<string>();

    if (!user.roles || !user.roles.isInitialized()) {
      return [];
    }

    const roleItems = user.roles.getItems();

    for (const role of roleItems) {
      if (role.permissions && Array.isArray(role.permissions)) {
        for (const permission of role.permissions) {
          permissions.add(permission);
        }
      }
    }

    return Array.from(permissions);
  }
}
