import { User } from "src/users/user.entity";

export type AccessTokenPayload = {
  username: string;
  sub: string;
  roles: string[];
  permissions: string[];
};

export type RefreshUser = {
  user: User;
  refreshToken: string;
  deviceId: string;
};
