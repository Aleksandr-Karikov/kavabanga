import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from "@nestjs/common";
import { RolesService } from "./roles.service";
import { JwtAuthGuard } from "../auth/strategies/access-jwt-strategy/jwt-auth.guard";
import { ApiBearerAuth, ApiTags, ApiOperation } from "@nestjs/swagger";
import { RoleName, Permission } from "src/shared/permissions";
import { Roles } from "src/shared/decorators/roles.decorator";
import { PermissionsGuard } from "src/shared/guards/permissions.guard";
import { RolesGuard } from "src/shared/guards/roles.guard";
import { RequireAllPermissions } from "src/shared/decorators/permissions.decorator";

@ApiTags("roles")
@ApiBearerAuth()
@Controller("roles")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @Roles(RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @RequireAllPermissions(Permission.ROLE_LIST)
  @ApiOperation({ summary: "Get all roles" })
  async findAll() {
    return await this.rolesService.findAll();
  }

  @Get(":id")
  @Roles(RoleName.ADMIN, RoleName.SUPER_ADMIN)
  @RequireAllPermissions(Permission.ROLE_READ)
  @ApiOperation({ summary: "Get role by ID" })
  async findOne(@Param("id") id: string) {
    return await this.rolesService.findById(id);
  }

  @Post()
  @Roles(RoleName.SUPER_ADMIN)
  @RequireAllPermissions(Permission.ROLE_CREATE)
  @ApiOperation({ summary: "Create new role" })
  async create(
    @Body()
    createDto: {
      name: string;
      description: string;
      permissions: Permission[];
    }
  ) {
    return await this.rolesService.createRole(
      createDto.name,
      createDto.description,
      createDto.permissions
    );
  }

  @Put(":id")
  @Roles(RoleName.SUPER_ADMIN)
  @RequireAllPermissions(Permission.ROLE_UPDATE)
  @ApiOperation({ summary: "Update role" })
  async update(
    @Param("id") id: string,
    @Body() updateDto: { description?: string; permissions?: Permission[] }
  ) {
    return await this.rolesService.updateRole(id, updateDto);
  }

  @Delete(":id")
  @Roles(RoleName.SUPER_ADMIN)
  @RequireAllPermissions(Permission.ROLE_DELETE)
  @ApiOperation({ summary: "Delete role" })
  async delete(@Param("id") id: string) {
    await this.rolesService.deleteRole(id);
    return { message: "Role deleted successfully" };
  }

  @Post(":id/permissions")
  @Roles(RoleName.SUPER_ADMIN)
  @RequireAllPermissions(Permission.ROLE_UPDATE)
  @ApiOperation({ summary: "Add permission to role" })
  async addPermission(
    @Param("id") id: string,
    @Body("permission") permission: Permission
  ) {
    return await this.rolesService.addPermission(id, permission);
  }

  @Delete(":id/permissions/:permission")
  @Roles(RoleName.SUPER_ADMIN)
  @RequireAllPermissions(Permission.ROLE_UPDATE)
  @ApiOperation({ summary: "Remove permission from role" })
  async removePermission(
    @Param("id") id: string,
    @Param("permission") permission: Permission
  ) {
    return await this.rolesService.removePermission(id, permission);
  }
}
