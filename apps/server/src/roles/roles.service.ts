import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { EntityManager } from "@mikro-orm/core";
import { Role } from "./role.entity";
import { Permission, RoleName } from "src/shared/permissions";

@Injectable()
export class RolesService {
  constructor(private readonly em: EntityManager) {}

  async createRole(
    name: string,
    description: string,
    permissions: Permission[]
  ): Promise<Role> {
    const existingRole = await this.em.findOne(Role, { name });

    if (existingRole) {
      throw new ConflictException(`Role with name '${name}' already exists`);
    }

    const role = this.em.create(Role, {
      name,
      description,
      permissions,
    });

    await this.em.persistAndFlush(role);
    return role;
  }

  async findAll(): Promise<Role[]> {
    return await this.em.find(Role, {});
  }

  async findById(id: string): Promise<Role> {
    const role = await this.em.findOne(Role, { id });

    if (!role) {
      throw new NotFoundException(`Role with id '${id}' not found`);
    }

    return role;
  }

  async findByName(name: string): Promise<Role | null> {
    return await this.em.findOne(Role, { name });
  }

  async updateRole(
    id: string,
    updates: { description?: string; permissions?: Permission[] }
  ): Promise<Role> {
    const role = await this.findById(id);

    if (updates.description !== undefined) {
      role.description = updates.description;
    }

    if (updates.permissions !== undefined) {
      role.permissions = updates.permissions;
    }

    await this.em.flush();
    return role;
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.findById(id);

    // Защита от удаления системных ролей
    if (Object.values(RoleName).includes(role.name as RoleName)) {
      throw new ConflictException("Cannot delete system role");
    }

    await this.em.removeAndFlush(role);
  }

  async addPermission(roleId: string, permission: Permission): Promise<Role> {
    const role = await this.findById(roleId);

    if (!role.permissions.includes(permission)) {
      role.permissions.push(permission);
      await this.em.flush();
    }

    return role;
  }

  async removePermission(
    roleId: string,
    permission: Permission
  ): Promise<Role> {
    const role = await this.findById(roleId);

    role.permissions = role.permissions.filter((p) => p !== permission);
    await this.em.flush();
    return role;
  }

  async seedDefaultRoles(): Promise<void> {
    const defaultRoles = [
      {
        name: RoleName.SUPER_ADMIN,
        description: "Super administrator with all permissions",
        permissions: Object.values(Permission),
      },
      {
        name: RoleName.ADMIN,
        description: "Administrator with most permissions",
        permissions: [
          Permission.USER_CREATE,
          Permission.USER_READ,
          Permission.USER_UPDATE,
          Permission.USER_LIST,
          Permission.CONTENT_CREATE,
          Permission.CONTENT_READ,
          Permission.CONTENT_UPDATE,
          Permission.CONTENT_DELETE,
          Permission.CONTENT_PUBLISH,
        ],
      },
      {
        name: RoleName.MODERATOR,
        description: "Moderator with content management permissions",
        permissions: [
          Permission.USER_READ,
          Permission.USER_LIST,
          Permission.CONTENT_READ,
          Permission.CONTENT_UPDATE,
          Permission.CONTENT_DELETE,
        ],
      },
      {
        name: RoleName.USER,
        description: "Regular user with basic permissions",
        permissions: [
          Permission.USER_READ,
          Permission.CONTENT_READ,
          Permission.CONTENT_CREATE,
        ],
      },
      {
        name: RoleName.GUEST,
        description: "Guest with read-only access",
        permissions: [Permission.CONTENT_READ],
      },
    ];

    for (const roleData of defaultRoles) {
      const existing = await this.findByName(roleData.name);
      if (!existing) {
        await this.createRole(
          roleData.name,
          roleData.description,
          roleData.permissions as Permission[]
        );
      }
    }
  }
}
