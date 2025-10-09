import { Injectable } from "@nestjs/common";
import { User } from "src/users/user.entity";
import * as bcrypt from "bcrypt";
import { v7 } from "uuid";
import { Collection } from "@mikro-orm/core";
import { Role } from "src/roles/role.entity";

@Injectable()
export class UsersService {
  private readonly users: User[];

  constructor() {
    this.users = this.createMockUsers();
  }

  private createMockUsers(): User[] {
    const user1 = new User();
    user1.uuid = v7();
    user1.username = "john";
    user1.password = bcrypt.hashSync("password", 10);
    user1.email = "john@example.com";
    user1.isActive = true;
    user1.roles = new Collection<Role>(user1);

    const user2 = new User();
    user2.uuid = "2";
    user2.username = "maria";
    user2.password = bcrypt.hashSync("guess", 10);
    user2.email = "maria@example.com";
    user2.isActive = false;
    user2.roles = new Collection<Role>(user2);

    user1.roles.set([]);
    user2.roles.set([]);

    return [user1, user2];
  }
  async findByUsername(username: string): Promise<User | undefined> {
    return this.users.find((user) => user.username === username);
  }

  async findByUUID(uuid: string): Promise<User | undefined> {
    return this.users.find((user) => user.uuid === uuid);
  }
}
