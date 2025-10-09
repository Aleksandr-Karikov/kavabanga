import {
  Entity,
  PrimaryKey,
  Property,
  ManyToMany,
  Collection,
} from "@mikro-orm/core";
import { v7 } from "uuid";
import { Role } from "../roles/role.entity";

@Entity()
export class User {
  @PrimaryKey()
  uuid: string = v7();

  @Property({ unique: true })
  email!: string;

  @Property({ unique: true })
  username!: string;

  @Property({ hidden: true })
  password!: string;

  @Property()
  isActive: boolean = true;

  @ManyToMany(() => Role, (role) => role.users, { owner: true, eager: true })
  roles = new Collection<Role>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  hasRole(roleName: string): boolean {
    return this.roles.getItems().some((role) => role.name === roleName);
  }

  hasPermission(permission: string): boolean {
    return this.roles
      .getItems()
      .some((role) => role.permissions.includes(permission));
  }

  hasAnyPermission(permissions: string[]): boolean {
    return permissions.some((permission) => this.hasPermission(permission));
  }

  hasAllPermissions(permissions: string[]): boolean {
    return permissions.every((permission) => this.hasPermission(permission));
  }

  getAllPermissions(): string[] {
    const permissions = new Set<string>();
    this.roles.getItems().forEach((role) => {
      role.permissions.forEach((permission) => permissions.add(permission));
    });
    return Array.from(permissions);
  }

  getRoleNames(): string[] {
    return this.roles.getItems().map((role) => role.name);
  }
}
