// Mock @nestjs/testing if not available
let Test: any;
let DynamicModule: any;

try {
  const testing = require("@nestjs/testing");
  const common = require("@nestjs/common");
  Test = testing.Test;
  DynamicModule = common.DynamicModule;
} catch {
  // Mock implementation for when @nestjs packages are not available
  Test = {
    createTestingModule: jest.fn(() => ({
      compile: jest.fn(() => ({
        get: jest.fn((token: any) => {
          if (token === "TokenRegistryService") return {};
          if (token === "TOKEN_REGISTRY_CONFIG") return {};
          if (token === "TOKEN_STORE_ADAPTER") return {};
          if (token === "TOKEN_VALIDATOR") return {};
          return {};
        }),
      })),
    })),
  };
  DynamicModule = {};
}
import {
  TokenRegistryModule,
  createBasicTokenRegistryModule,
  createTestTokenRegistryModule,
  TOKEN_REGISTRY_CONFIG,
  TOKEN_STORE_ADAPTER,
  TOKEN_VALIDATOR,
  TOKEN_PLUGINS,
} from "../module";
import { TokenRegistryService } from "../core/service";
import { InMemoryStoreAdapter } from "../adapters/memory.adapter";
import { DefaultTokenValidator, NoOpValidator } from "../core/validators";
import {
  ITokenPlugin,
  TokenConfigurationError,
  DEFAULT_CONFIG,
} from "../core/interfaces";

const createMockPlugin = (name: string): ITokenPlugin => ({
  name,
  priority: 100,
  preSave: jest.fn(),
  postSave: jest.fn(),
});

describe("TokenRegistryModule", () => {
  describe("forRoot", () => {
    it("should create module with basic configuration", async () => {
      const adapter = new InMemoryStoreAdapter();

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: adapter,
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;
      const config = module.get(TOKEN_REGISTRY_CONFIG);
      const storeAdapter = module.get(TOKEN_STORE_ADAPTER);

      expect(service).toBeInstanceOf(TokenRegistryService);
      expect(config).toEqual({
        ...DEFAULT_CONFIG,
      });
      expect(storeAdapter).toBe(adapter);
    });

    it("should create module with custom configuration", async () => {
      const adapter = new InMemoryStoreAdapter();
      const customConfig = {
        enableValidation: false,
        defaultTtl: 7200,
        strictMode: true,
      };

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: adapter,
            config: customConfig,
          }),
        ],
      }).compile();

      const config = module.get(TOKEN_REGISTRY_CONFIG);

      expect(config).toEqual({
        ...DEFAULT_CONFIG,
        ...customConfig,
      });
    });

    it("should create module with custom validator", async () => {
      const adapter = new InMemoryStoreAdapter();
      const validator = new NoOpValidator();

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: adapter,
            validator,
          }),
        ],
      }).compile();

      const resolvedValidator = module.get(TOKEN_VALIDATOR);

      expect(resolvedValidator).toBe(validator);
    });

    it("should create module with plugins", async () => {
      const adapter = new InMemoryStoreAdapter();
      const plugins = [
        createMockPlugin("Plugin1"),
        createMockPlugin("Plugin2"),
      ];

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: adapter,
            plugins,
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      expect(service.getRegisteredPlugins()).toHaveLength(2);
      expect(service.getRegisteredPlugins().map((p: any) => p.name)).toEqual([
        "Plugin1",
        "Plugin2",
      ]);
    });

    it("should create global module when specified", async () => {
      const adapter = new InMemoryStoreAdapter();

      const moduleRef: any = TokenRegistryModule.forRoot({
        storeAdapter: adapter,
        isGlobal: true,
      });

      expect(moduleRef.global).toBe(true);
    });

    it("should validate options and throw on invalid config", () => {
      expect(() => {
        TokenRegistryModule.forRoot({
          storeAdapter: new InMemoryStoreAdapter(),
          config: {
            defaultTtl: -1, // Invalid
          },
        });
      }).toThrow(TokenConfigurationError);
    });

    it("should throw when no store adapter provided", () => {
      expect(() => {
        TokenRegistryModule.forRoot({} as any);
      }).toThrow(TokenConfigurationError);
    });

    it("should prevent duplicate plugin names", () => {
      const plugins = [
        createMockPlugin("DuplicateName"),
        createMockPlugin("DuplicateName"),
      ];

      expect(() => {
        TokenRegistryModule.forRoot({
          storeAdapter: new InMemoryStoreAdapter(),
          plugins,
        });
      }).toThrow(TokenConfigurationError);
    });
  });

  describe("forRootAsync", () => {
    it("should create module with useFactory", async () => {
      const adapter = new InMemoryStoreAdapter();

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRootAsync({
            useFactory: () => ({
              storeAdapter: adapter,
              config: {
                defaultTtl: 7200,
              },
            }),
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;
      const config = module.get(TOKEN_REGISTRY_CONFIG);

      expect(service).toBeInstanceOf(TokenRegistryService);
      expect(config.defaultTtl).toBe(7200);
    });

    it("should handle async factory", async () => {
      const adapter = new InMemoryStoreAdapter();

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRootAsync({
            useFactory: async () => {
              // Simulate async operation
              await new Promise((resolve) => setTimeout(resolve, 10));
              return {
                storeAdapter: adapter,
              };
            },
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      expect(service).toBeInstanceOf(TokenRegistryService);
    });

    it("should inject dependencies into factory", async () => {
      const mockService = { getAdapter: () => new InMemoryStoreAdapter() };

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRootAsync({
            useFactory: (adapterService: any) => ({
              storeAdapter: adapterService.getAdapter(),
            }),
            inject: ["ADAPTER_SERVICE"],
            extraProviders: [
              { provide: "ADAPTER_SERVICE", useValue: mockService },
            ],
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      expect(service).toBeInstanceOf(TokenRegistryService);
    });
    it("should create global module when specified", async () => {
      const moduleRef: typeof DynamicModule = TokenRegistryModule.forRootAsync({
        useFactory: () => ({
          storeAdapter: new InMemoryStoreAdapter(),
        }),
        isGlobal: true,
      });

      expect(moduleRef.global).toBe(true);
    });

    it("should throw when no factory provided", () => {
      expect(() => {
        TokenRegistryModule.forRootAsync({} as any);
      }).toThrow(TokenConfigurationError);
    });
  });

  describe("provider creation", () => {
    it("should create config provider with defaults", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
          }),
        ],
      }).compile();

      const config = module.get(TOKEN_REGISTRY_CONFIG);

      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it("should create adapter provider from instance", async () => {
      const adapter = new InMemoryStoreAdapter();

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: adapter,
          }),
        ],
      }).compile();

      const resolvedAdapter = module.get(TOKEN_STORE_ADAPTER);

      expect(resolvedAdapter).toBe(adapter);
    });

    it("should create adapter provider from class", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: InMemoryStoreAdapter,
          }),
        ],
      }).compile();

      const adapter = module.get(TOKEN_STORE_ADAPTER);

      expect(adapter).toBeInstanceOf(InMemoryStoreAdapter);
    });

    it("should create default validator when none specified", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
          }),
        ],
      }).compile();

      const validator = module.get(TOKEN_VALIDATOR);

      expect(validator).toBeInstanceOf(DefaultTokenValidator);
    });

    it("should create NoOp validator when specified", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            validator: "none",
          }),
        ],
      }).compile();

      const validator = module.get(TOKEN_VALIDATOR);

      expect(validator).toBeInstanceOf(NoOpValidator);
    });

    it("should register plugins in service", async () => {
      const plugins = [
        createMockPlugin("Plugin1"),
        createMockPlugin("Plugin2"),
      ];

      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            plugins,
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      expect(service.getRegisteredPlugins()).toHaveLength(2);
    });
  });

  describe("integration", () => {
    it("should work end-to-end with token operations", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      const tokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        meta: {
          deviceId: "device123",
        },
      };

      // Save token
      await service.saveToken("test-token", tokenData, 60);

      // Retrieve token
      const retrievedData = await service.getTokenData("test-token");
      expect(retrievedData).toEqual(tokenData);

      // Revoke token
      await service.revokeToken("test-token");

      // Verify token is gone
      const afterRevoke = await service.getTokenData("test-token");
      expect(afterRevoke).toBeNull();
    });

    it("should respect configuration settings", async () => {
      const module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeAdapter: new InMemoryStoreAdapter(),
            config: {
              enableValidation: false,
            },
            validator: "none",
          }),
        ],
      }).compile();

      const service = module.get(TokenRegistryService) as TokenRegistryService;

      // Should work even with invalid data since validation is disabled
      await expect(
        service.saveToken("invalid-token", {} as any, -1)
      ).resolves.not.toThrow();
    });
  });
});

describe("Helper Functions", () => {
  describe("createBasicTokenRegistryModule", () => {
    it("should create basic module with minimal config", () => {
      const adapter = new InMemoryStoreAdapter();

      const moduleRef = createBasicTokenRegistryModule(adapter);

      expect(moduleRef.module).toBe(TokenRegistryModule);
      expect(moduleRef.global).toBe(true);
    });

    it("should accept config overrides", () => {
      const adapter = new InMemoryStoreAdapter();
      const configOverrides = { defaultTtl: 7200 };

      const moduleRef = createBasicTokenRegistryModule(
        adapter,
        configOverrides
      );

      expect(moduleRef.module).toBe(TokenRegistryModule);
    });
  });

  describe("createTestTokenRegistryModule", () => {
    it("should create module optimized for testing", async () => {
      const adapter = new InMemoryStoreAdapter();

      const module = await Test.createTestingModule({
        imports: [createTestTokenRegistryModule(adapter)],
      }).compile();

      const config = module.get(TOKEN_REGISTRY_CONFIG);
      const validator = module.get(TOKEN_VALIDATOR);

      expect(config.enableValidation).toBe(false);
      expect(config.enablePlugins).toBe(false);
      expect(config.operationTimeout).toBe(0);
      expect(validator).toBeInstanceOf(NoOpValidator);
    });

    it("should not be global by default", () => {
      const adapter = new InMemoryStoreAdapter();

      const moduleRef = createTestTokenRegistryModule(adapter);

      expect(moduleRef.global).toBe(false);
    });
  });
});
