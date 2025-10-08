import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { UsersService } from "../users/users.service";

describe("AuthService", () => {
  let service: AuthService;

  const mockUsersService = {
    findOne: jest.fn(),
    create: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockTokenRegistryService = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: "TOKEN_REGISTRY_SERVICE",
          useValue: mockTokenRegistryService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });
});
