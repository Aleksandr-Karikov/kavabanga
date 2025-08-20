import { Test, TestingModule } from "@nestjs/testing";
import { TokenRegistryModule } from "../token-registry.module";
import {
  TokenRegistryService,
  TokenData,
  ITokenMeta,
  createMemoryStore,
} from "@kavabanga/token-registry-core";
import { TOKEN_REGISTRY_SERVICE } from "../constants";

interface TestTokenMeta extends ITokenMeta {
  deviceId: string;
  ipAddress: string;
}

describe("TokenRegistryModule", () => {
  let module: TestingModule;
  let tokenRegistry: TokenRegistryService<TestTokenMeta>;

  describe("forRoot with default memory store", () => {
    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            config: {
              defaultTtl: 30 * 24 * 60 * 60, // 30 days
              enableValidation: true,
              enableEvents: true,
            },
          }),
        ],
      }).compile();

      tokenRegistry = module.get<TokenRegistryService<TestTokenMeta>>(
        TOKEN_REGISTRY_SERVICE
      );
    });

    afterEach(async () => {
      if (module) {
        await module.close();
      }
    });

    it("should create module with default memory store", () => {
      expect(tokenRegistry).toBeDefined();
    });

    it("should save and retrieve token data", async () => {
      const token = "test-token-123";
      const tokenData: TokenData<TestTokenMeta> = {
        sub: "user-456",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        meta: {
          deviceId: "device-789",
          ipAddress: "192.168.1.100",
        },
      };

      // Save token
      await tokenRegistry.saveToken(token, tokenData);

      // Retrieve token data
      const retrievedData = await tokenRegistry.getTokenData(token);

      expect(retrievedData).toBeDefined();
      expect(retrievedData?.sub).toBe(tokenData.sub);
      expect(retrievedData?.meta.deviceId).toBe(tokenData.meta.deviceId);
      expect(retrievedData?.meta.ipAddress).toBe(tokenData.meta.ipAddress);
    });

    it("should revoke token", async () => {
      const token = "test-token-to-revoke";
      const tokenData: TokenData<TestTokenMeta> = {
        sub: "user-456",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        meta: {
          deviceId: "device-789",
          ipAddress: "192.168.1.100",
        },
      };

      // Save token
      await tokenRegistry.saveToken(token, tokenData);

      // Verify token exists
      const tokenDataBefore = await tokenRegistry.getTokenData(token);
      expect(tokenDataBefore).toBeDefined();

      // Revoke token
      await tokenRegistry.revokeToken(token);

      // Verify token is deleted
      const tokenDataAfter = await tokenRegistry.getTokenData(token);
      expect(tokenDataAfter).toBeNull();
    });

    it("should check health status", async () => {
      const isHealthy = await tokenRegistry.getHealthStatus();
      expect(isHealthy).toBe(true);
    });
  });

  describe("forRoot with custom store factory", () => {
    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            storeFactory: () => createMemoryStore(),
            config: {
              defaultTtl: 3600, // 1 hour
              enableValidation: true,
              enableEvents: false,
            },
          }),
        ],
      }).compile();

      tokenRegistry = module.get<TokenRegistryService<TestTokenMeta>>(
        TOKEN_REGISTRY_SERVICE
      );
    });

    afterEach(async () => {
      if (module) {
        await module.close();
      }
    });

    it("should create module with custom store factory", () => {
      expect(tokenRegistry).toBeDefined();
    });

    it("should use custom configuration", async () => {
      const token = "test-token-custom";
      const tokenData: TokenData<TestTokenMeta> = {
        sub: "user-456",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600 * 1000,
        meta: {
          deviceId: "device-789",
          ipAddress: "192.168.1.100",
        },
      };

      await tokenRegistry.saveToken(token, tokenData);
      const retrievedData = await tokenRegistry.getTokenData(token);

      expect(retrievedData).toBeDefined();
      expect(retrievedData?.sub).toBe(tokenData.sub);
    });
  });

  describe("forRootAsync", () => {
    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRootAsync({
            useFactory: () => ({
              storeFactory: () => createMemoryStore(),
              config: {
                defaultTtl: 7200, // 2 hours
                enableValidation: false,
                enableEvents: true,
              },
            }),
          }),
        ],
      }).compile();

      tokenRegistry = module.get<TokenRegistryService<TestTokenMeta>>(
        TOKEN_REGISTRY_SERVICE
      );
    });

    afterEach(async () => {
      if (module) {
        await module.close();
      }
    });

    it("should create module with async configuration", () => {
      expect(tokenRegistry).toBeDefined();
    });

    it("should work with async configuration", async () => {
      const token = "test-token-async";
      const tokenData: TokenData<TestTokenMeta> = {
        sub: "user-456",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 7200 * 1000,
        meta: {
          deviceId: "device-789",
          ipAddress: "192.168.1.100",
        },
      };

      await tokenRegistry.saveToken(token, tokenData);
      const retrievedData = await tokenRegistry.getTokenData(token);

      expect(retrievedData).toBeDefined();
      expect(retrievedData?.sub).toBe(tokenData.sub);
    });
  });

  describe("global module", () => {
    beforeEach(async () => {
      module = await Test.createTestingModule({
        imports: [
          TokenRegistryModule.forRoot({
            global: true,
            config: {
              defaultTtl: 30 * 24 * 60 * 60,
              enableValidation: true,
              enableEvents: true,
            },
          }),
        ],
      }).compile();

      tokenRegistry = module.get<TokenRegistryService<TestTokenMeta>>(
        TOKEN_REGISTRY_SERVICE
      );
    });

    afterEach(async () => {
      if (module) {
        await module.close();
      }
    });

    it("should create global module", () => {
      expect(tokenRegistry).toBeDefined();
    });
  });
});
