import { Injectable } from "@nestjs/common";
import { User } from "src/users/user.entity";

@Injectable()
export class UsersService {
  private readonly users: User[] = [
    {
      uuid: "1",
      username: "john",
      password: "changeme",
      email: "",
    },
    {
      uuid: "2",
      username: "maria",
      password: "guess",
      email: "",
    },
  ];

  async findOne(username: string): Promise<User | undefined> {
    return this.users.find((user) => user.username === username);
  }
}
