import { User } from "src/users/user.entity";

export type TokenPayload = {
  username: string;
  sub: string;
};

export type RefreshUser = {
  user: User;
  refreshToken: string;
  deviceId: string;
};
