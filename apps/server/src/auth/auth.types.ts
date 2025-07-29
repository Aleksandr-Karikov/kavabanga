export type TokenPayload = {
  username: string;
  sub: string;
};

export type RefreshTokenPayload = TokenPayload & {
  refresh: true;
};
