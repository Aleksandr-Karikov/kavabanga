import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { v7 } from "uuid";

@Entity()
export class User {
  @PrimaryKey()
  uuid = v7();

  @Property()
  email!: string;

  @Property()
  username!: string;

  @Property()
  password!: string;
}
