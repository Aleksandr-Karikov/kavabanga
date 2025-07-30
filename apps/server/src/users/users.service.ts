import { Injectable } from "@nestjs/common";
import { User } from "src/users/user.entity";
import * as bcrypt from "bcrypt";
import { v7 } from "uuid";

@Injectable()
export class UsersService {
  private readonly users: User[] = [
    {
      uuid: v7(),
      username: "john",
      password: bcrypt.hashSync("password", 10),
      email: "",
    },
    {
      uuid: "2",
      username: "maria",
      password: "guess",
      email: "",
    },
  ];

  async findByUsername(username: string): Promise<User | undefined> {
    return this.users.find((user) => user.username === username);
  }

  async findByUUID(uuid: string): Promise<User | undefined> {
    return this.users.find((user) => user.uuid === uuid);
  }
}
