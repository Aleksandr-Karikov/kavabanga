import RedisMock from "ioredis-mock";
import { IoredisStoreAdapter } from "../ioredis.adapter";
import {
  BaseStoreAdapter,
  TokenSaveRequest,
  ITokenStoreAdapter,
} from "@kavabanga/token-registry-core";

function createTestRequest(): TokenSaveRequest {
  return {
    token: "test-token",
    data: {
      expiresAt: Date.now() + 1000,
      issuedAt: Date.now(),
      meta: {
        deviceId: "test-device",
        ipAddress: "127.0.0.1",
      },
      sub: "test-user",
    },
    ttl: 1000,
  };
}

describe("IoredisAdapter", () => {
  let adapter: IoredisStoreAdapter;

  beforeEach(() => {
    // Use fallback mode for ioredis-mock compatibility
    adapter = new IoredisStoreAdapter(new RedisMock(), { useUserSets: false });
  });

  afterEach((done) => {
    new RedisMock().flushall().then(() => done());
  });

  it("should extend BaseStoreAdapter", () => {
    expect(adapter).toBeInstanceOf(BaseStoreAdapter);
  });

  it("should implement interface ITokenStoreAdapter", async () => {
    expect(adapter).toMatchObject<ITokenStoreAdapter>({
      saveToken: expect.any(Function),
      getTokenData: expect.any(Function),
      deleteToken: expect.any(Function),
      isHealthy: expect.any(Function),
    });
  });

  it("should be healthy", async () => {
    const health = await adapter.isHealthy();
    expect(health).toBe(true);
  });

  describe("saveToken", () => {
    it("should save token successfully", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      const data = await adapter.getTokenData(request.token);
      expect(data).toEqual(request.data);
    });

    it("should throw error if token is not a string", async () => {
      const request = createTestRequest();
      request.token = 123 as any;
      await expect(adapter.saveToken(request)).rejects.toThrow(
        "Invalid token format"
      );
    });

    it("should throw error if token is empty", async () => {
      const request = createTestRequest();
      request.token = "" as any;
      await expect(adapter.saveToken(request)).rejects.toThrow(
        "Invalid token format"
      );
    });
  });

  describe("getTokenData", () => {
    it("should get token data successfully", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      const data = await adapter.getTokenData(request.token);
      expect(data).toEqual(request.data);
    });

    it("should throw error if token is not a string", async () => {
      const request = createTestRequest();
      request.token = 123 as any;
      await expect(adapter.getTokenData(request.token)).rejects.toThrow(
        "Invalid token format"
      );
    });

    it("should throw error if token is empty", async () => {
      const request = createTestRequest();
      request.token = "" as any;
      await expect(adapter.getTokenData(request.token)).rejects.toThrow(
        "Invalid token format"
      );
    });
  });

  describe("deleteToken", () => {
    it("should delete token successfully", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      await adapter.deleteToken(request.token);

      const data = await adapter.getTokenData(request.token);
      expect(data).toBeNull();
    });

    it("should throw error if token is not a string", async () => {
      const request = createTestRequest();
      request.token = 123 as any;
      await expect(adapter.deleteToken(request.token)).rejects.toThrow(
        "Invalid token format"
      );
    });

    it("should throw error if token is empty", async () => {
      const request = createTestRequest();
      request.token = "" as any;
      await expect(adapter.deleteToken(request.token)).rejects.toThrow(
        "Invalid token format"
      );
    });
  });

  describe("isHealthy", () => {
    it("should be healthy", async () => {
      const health = await adapter.isHealthy();
      expect(health).toBe(true);
    });

    it("should return false when Redis is not available", async () => {
      const mockRedis = {
        ping: jest.fn().mockRejectedValue(new Error("Connection failed")),
      } as any;

      const adapter = new IoredisStoreAdapter(mockRedis);
      const health = await adapter.isHealthy();
      expect(health).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle Redis connection errors in saveToken", async () => {
      const mockRedis = {
        set: jest.fn().mockRejectedValue(new Error("Redis connection lost")),
      } as any;

      const adapter = new IoredisStoreAdapter(mockRedis);
      const request = createTestRequest();

      await expect(adapter.saveToken(request)).rejects.toThrow(
        "Operation 'saveToken' failed"
      );
    });

    it("should handle Redis connection errors in getTokenData", async () => {
      const mockRedis = {
        get: jest.fn().mockRejectedValue(new Error("Redis connection lost")),
      } as any;

      const adapter = new IoredisStoreAdapter(mockRedis);

      await expect(adapter.getTokenData("test-token")).rejects.toThrow(
        "Operation 'getTokenData' failed"
      );
    });

    it("should handle Redis connection errors in deleteToken", async () => {
      const mockRedis = {
        del: jest.fn().mockRejectedValue(new Error("Redis connection lost")),
      } as any;

      const adapter = new IoredisStoreAdapter(mockRedis);

      await expect(adapter.deleteToken("test-token")).rejects.toThrow(
        "Operation 'deleteToken' failed"
      );
    });

    it("should handle JSON parsing errors", async () => {
      const mockRedis = {
        get: jest.fn().mockResolvedValue("invalid-json"),
      } as any;

      const adapter = new IoredisStoreAdapter(mockRedis);

      await expect(adapter.getTokenData("test-token")).rejects.toThrow(
        "Operation 'getTokenData' failed"
      );
    });
  });

  describe("custom key prefix", () => {
    it("should use default prefix 'token'", async () => {
      const mockRedis = new RedisMock();
      const adapter = new IoredisStoreAdapter(mockRedis);
      const request = createTestRequest();

      await adapter.saveToken(request);

      // Check that key was created with 'token:' prefix
      const keys = await mockRedis.keys("*");
      expect(keys).toContain(`token:${request.token}`);
    });

    it("should use custom prefix when provided", async () => {
      const mockRedis = new RedisMock();
      const adapter = new IoredisStoreAdapter(mockRedis, { keyPrefix: "auth" });
      const request = createTestRequest();

      await adapter.saveToken(request);

      // Check that key was created with 'auth:' prefix
      const keys = await mockRedis.keys("*");
      expect(keys).toContain(`auth:${request.token}`);
      expect(keys).not.toContain(`token:${request.token}`);
    });

    it("should retrieve token with custom prefix", async () => {
      const mockRedis = new RedisMock();
      const adapter = new IoredisStoreAdapter(mockRedis, {
        keyPrefix: "session",
      });
      const request = createTestRequest();

      await adapter.saveToken(request);
      const data = await adapter.getTokenData(request.token);

      expect(data).toEqual(request.data);
    });

    it("should delete token with custom prefix", async () => {
      const mockRedis = new RedisMock();
      const adapter = new IoredisStoreAdapter(mockRedis, { keyPrefix: "jwt" });
      const request = createTestRequest();

      await adapter.saveToken(request);
      await adapter.deleteToken(request.token);

      const data = await adapter.getTokenData(request.token);
      expect(data).toBeNull();

      const keys = await mockRedis.keys("*");
      expect(keys).not.toContain(`jwt:${request.token}`);
    });
  });

  describe("user token management", () => {
    let adapter: IoredisStoreAdapter;
    let mockRedis: any;

    beforeEach(() => {
      mockRedis = new RedisMock();
      // Use fallback mode for ioredis-mock compatibility
      adapter = new IoredisStoreAdapter(mockRedis, { useUserSets: false });
    });

    describe("getUserTokens", () => {
      it("should return all tokens for a specific user", async () => {
        const user1Token1 = {
          ...createTestRequest(),
          token: "user1-token1",
          data: { ...createTestRequest().data, sub: "user1" },
        };
        const user1Token2 = {
          ...createTestRequest(),
          token: "user1-token2",
          data: { ...createTestRequest().data, sub: "user1" },
        };
        const user2Token = {
          ...createTestRequest(),
          token: "user2-token",
          data: { ...createTestRequest().data, sub: "user2" },
        };

        await adapter.saveToken(user1Token1);
        await adapter.saveToken(user1Token2);
        await adapter.saveToken(user2Token);

        const user1Tokens = await adapter.getUserTokens("user1");
        expect(user1Tokens).toHaveLength(2);
        expect(user1Tokens.map((t) => t.token)).toContain("user1-token1");
        expect(user1Tokens.map((t) => t.token)).toContain("user1-token2");
        expect(user1Tokens.every((t) => t.data.sub === "user1")).toBe(true);
      });

      it("should return empty array for user with no tokens", async () => {
        const tokens = await adapter.getUserTokens("nonexistent-user");
        expect(tokens).toEqual([]);
      });
    });

    describe("revokeUserTokens", () => {
      it("should revoke all tokens for a specific user", async () => {
        const user1Token1 = {
          ...createTestRequest(),
          token: "user1-token1",
          data: { ...createTestRequest().data, sub: "user1" },
        };
        const user1Token2 = {
          ...createTestRequest(),
          token: "user1-token2",
          data: { ...createTestRequest().data, sub: "user1" },
        };
        const user2Token = {
          ...createTestRequest(),
          token: "user2-token",
          data: { ...createTestRequest().data, sub: "user2" },
        };

        await adapter.saveToken(user1Token1);
        await adapter.saveToken(user1Token2);
        await adapter.saveToken(user2Token);

        const deletedCount = await adapter.revokeUserTokens("user1");
        expect(deletedCount).toBe(2);

        const user1Tokens = await adapter.getUserTokens("user1");
        expect(user1Tokens).toHaveLength(0);

        const user2Tokens = await adapter.getUserTokens("user2");
        expect(user2Tokens).toHaveLength(1);
      });

      it("should return 0 for user with no tokens", async () => {
        const deletedCount = await adapter.revokeUserTokens("nonexistent-user");
        expect(deletedCount).toBe(0);
      });
    });

    describe("revokeTokensByDevice", () => {
      it("should revoke tokens for specific user and device", async () => {
        const user1Device1 = {
          ...createTestRequest(),
          token: "user1-device1-token",
          data: {
            ...createTestRequest().data,
            sub: "user1",
            meta: { ...createTestRequest().data.meta, deviceId: "device1" },
          },
        };
        const user1Device2 = {
          ...createTestRequest(),
          token: "user1-device2-token",
          data: {
            ...createTestRequest().data,
            sub: "user1",
            meta: { ...createTestRequest().data.meta, deviceId: "device2" },
          },
        };

        await adapter.saveToken(user1Device1);
        await adapter.saveToken(user1Device2);

        const deletedCount = await adapter.revokeTokensByDevice(
          "user1",
          "device1"
        );
        expect(deletedCount).toBe(1);

        const remainingTokens = await adapter.getUserTokens("user1");
        expect(remainingTokens).toHaveLength(1);
        expect(remainingTokens[0]?.data.meta.deviceId).toBe("device2");
      });
    });

    describe("getUserDeviceTokens", () => {
      it("should return tokens for specific user and device", async () => {
        const user1Device1 = {
          ...createTestRequest(),
          token: "user1-device1-token",
          data: {
            ...createTestRequest().data,
            sub: "user1",
            meta: { ...createTestRequest().data.meta, deviceId: "device1" },
          },
        };
        const user1Device2 = {
          ...createTestRequest(),
          token: "user1-device2-token",
          data: {
            ...createTestRequest().data,
            sub: "user1",
            meta: { ...createTestRequest().data.meta, deviceId: "device2" },
          },
        };

        await adapter.saveToken(user1Device1);
        await adapter.saveToken(user1Device2);

        const device1Tokens = await adapter.getUserDeviceTokens(
          "user1",
          "device1"
        );
        expect(device1Tokens).toHaveLength(1);
        expect(device1Tokens[0]?.token).toBe("user1-device1-token");
      });
    });

    describe("getUserTokenCount", () => {
      it("should return correct count of user tokens", async () => {
        const user1Token1 = {
          ...createTestRequest(),
          token: "user1-token1",
          data: { ...createTestRequest().data, sub: "user1" },
        };
        const user1Token2 = {
          ...createTestRequest(),
          token: "user1-token2",
          data: { ...createTestRequest().data, sub: "user1" },
        };

        await adapter.saveToken(user1Token1);
        await adapter.saveToken(user1Token2);

        const count = await adapter.getUserTokenCount("user1");
        expect(count).toBe(2);
      });

      it("should return 0 for user with no tokens", async () => {
        const count = await adapter.getUserTokenCount("nonexistent-user");
        expect(count).toBe(0);
      });
    });

    describe("getTokenStats", () => {
      it("should return correct statistics in fallback mode", async () => {
        const fallbackAdapter = new IoredisStoreAdapter(mockRedis, {
          useUserSets: false,
        });

        const user1Token = {
          ...createTestRequest(),
          token: "user1-token",
          data: { ...createTestRequest().data, sub: "user1" },
        };

        await fallbackAdapter.saveToken(user1Token);

        const stats = await fallbackAdapter.getTokenStats();
        expect(stats.totalTokens).toBeGreaterThanOrEqual(1);
        expect(stats.userSetsEnabled).toBe(false);
        expect(stats.keyPrefix).toBe("token");
      });
    });

    describe("optimized operations", () => {
      it("should use user sets for efficient token management", async () => {
        const optimizedAdapter = new IoredisStoreAdapter(mockRedis, {
          useUserSets: true,
        });

        const user1Token = {
          ...createTestRequest(),
          token: "user1-token",
          data: { ...createTestRequest().data, sub: "user1" },
        };

        await optimizedAdapter.saveToken(user1Token);

        // Should be able to get count efficiently
        const count = await optimizedAdapter.getUserTokenCount("user1");
        expect(count).toBe(1);

        // Should be able to revoke efficiently
        const revokedCount = await optimizedAdapter.revokeUserTokens("user1");
        expect(revokedCount).toBe(1);
      });

      it("should fall back to pattern scanning when user sets disabled", async () => {
        const fallbackAdapter = new IoredisStoreAdapter(mockRedis, {
          useUserSets: false,
        });

        const user1Token = {
          ...createTestRequest(),
          token: "user1-token",
          data: { ...createTestRequest().data, sub: "user1" },
        };

        await fallbackAdapter.saveToken(user1Token);
        const count = await fallbackAdapter.getUserTokenCount("user1");
        expect(count).toBe(1);
      });

      it("should provide appropriate stats based on mode", async () => {
        const optimizedAdapter = new IoredisStoreAdapter(mockRedis, {
          useUserSets: true,
        });

        const stats = await optimizedAdapter.getTokenStats();
        expect(stats.userSetsEnabled).toBe(true);
        expect(stats.totalTokens).toBe(-1); // Not available in optimized mode
        expect(stats.keyPrefix).toBe("token");
        expect(stats.warning).toContain("optimized mode");
      });
    });

    describe("user sets maintenance", () => {
      it("should cleanup stale user set references", async () => {
        const optimizedAdapter = new IoredisStoreAdapter(mockRedis, {
          useUserSets: true,
        });

        const result = await optimizedAdapter.cleanupUserSets();
        expect(result.userSetsEnabled).toBe(true);
        expect(typeof result.cleanedSets).toBe("number");
        expect(typeof result.cleanedReferences).toBe("number");
      });

      it("should return zero cleanup for fallback mode", async () => {
        const fallbackAdapter = new IoredisStoreAdapter(mockRedis, {
          useUserSets: false,
        });

        const result = await fallbackAdapter.cleanupUserSets();
        expect(result.userSetsEnabled).toBe(false);
        expect(result.cleanedSets).toBe(0);
        expect(result.cleanedReferences).toBe(0);
      });

      it("should provide user sets information", async () => {
        const optimizedAdapter = new IoredisStoreAdapter(mockRedis, {
          useUserSets: true,
        });

        const info = await optimizedAdapter.getUserSetsInfo();
        expect(info.userSetsEnabled).toBe(true);
        expect(typeof info.totalUserSets).toBe("number");
      });

      it("should return zero info for fallback mode", async () => {
        const fallbackAdapter = new IoredisStoreAdapter(mockRedis, {
          useUserSets: false,
        });

        const info = await fallbackAdapter.getUserSetsInfo();
        expect(info.userSetsEnabled).toBe(false);
        expect(info.totalUserSets).toBe(0);
        expect(info.avgTokensPerSet).toBeUndefined();
      });
    });
  });
});
