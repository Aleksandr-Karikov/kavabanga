import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "src/shared/decorators/roles.decorator";
import { RoleName } from "src/shared/permissions";
import { User } from "src/users/user.entity";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleName[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User = request.user;

    if (!user) {
      throw new ForbiddenException("User not authenticated");
    }

    const hasRole = requiredRoles.some((role) => user.hasRole(role));

    if (!hasRole) {
      throw new ForbiddenException(
        `User does not have required role. Required: [${requiredRoles.join(", ")}]`
      );
    }

    return true;
  }
}
