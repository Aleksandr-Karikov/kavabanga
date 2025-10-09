import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "src/shared/decorators/permissions.decorator";
import { Permission } from "src/shared/permissions";
import { User } from "src/users/user.entity";

interface PermissionOptions {
  permissions: Permission[];
  requireAll: boolean;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permissionOptions =
      this.reflector.getAllAndOverride<PermissionOptions>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (
      !permissionOptions ||
      !permissionOptions.permissions ||
      permissionOptions.permissions.length === 0
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User = request.user;

    if (!user) {
      throw new ForbiddenException("User not authenticated");
    }

    const { permissions, requireAll } = permissionOptions;

    const hasPermission = requireAll
      ? user.hasAllPermissions(permissions)
      : user.hasAnyPermission(permissions);

    if (!hasPermission) {
      const mode = requireAll ? "ALL" : "ANY";
      throw new ForbiddenException(
        `User does not have required permissions. Required (${mode}): [${permissions.join(", ")}]`
      );
    }

    return true;
  }
}
