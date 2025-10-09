import { SetMetadata } from "@nestjs/common";
import { Permission } from "src/shared/permissions";

export const PERMISSIONS_KEY = "permissions";

export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, { permissions, requireAll: false });

export const RequireAllPermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, { permissions, requireAll: true });

export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, { permissions, requireAll: false });
