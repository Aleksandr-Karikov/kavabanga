import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { v4 } from "uuid";

@Entity()
export class User {
  @PrimaryKey()
  uuid = v4();

  @Property()
  email!: string;

  @Property()
  username!: string;

  @Property()
  password!: string;
}
