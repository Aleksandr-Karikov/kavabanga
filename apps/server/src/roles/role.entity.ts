import {
  Entity,
  PrimaryKey,
  Property,
  ManyToMany,
  Collection,
} from "@mikro-orm/core";
import { v7 } from "uuid";
import { User } from "../users/user.entity";

@Entity()
export class Role {
  @PrimaryKey()
  id: string = v7();

  @Property({ unique: true })
  name!: string;

  @Property({ nullable: true })
  description?: string;

  @Property({ type: "json" })
  permissions: string[] = [];

  @ManyToMany(() => User, (user) => user.roles)
  users = new Collection<User>(this);

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
