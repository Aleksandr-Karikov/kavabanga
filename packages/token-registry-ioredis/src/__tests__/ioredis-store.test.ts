import { IoredisStore, createIoredisStore } from "../index";
import { TokenData } from "@kavabanga/token-registry-core";
import Redis from "ioredis";

// Mock ioredis
jest.mock("ioredis");

describe("IoredisStore", () => {
  let store: IoredisStore;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create mock Redis instance
    mockRedis = new Redis() as jest.Mocked<Redis>;
    store = new IoredisStore(mockRedis);
  });

  describe("save", () => {
    it("should save token data with TTL", async () => {
      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      mockRedis.setex.mockResolvedValue("OK");

      await store.save(token, data, ttl);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "token:test-token",
        ttl,
        JSON.stringify(data)
      );
    });
  });

  describe("get", () => {
    it("should return token data when token exists", async () => {
      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(data));

      const result = await store.get(token);

      expect(mockRedis.get).toHaveBeenCalledWith("token:test-token");
      expect(result).toEqual(data);
    });

    it("should return null when token does not exist", async () => {
      const token = "non-existent-token";

      mockRedis.get.mockResolvedValue(null);

      const result = await store.get(token);

      expect(mockRedis.get).toHaveBeenCalledWith("token:non-existent-token");
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete token", async () => {
      const token = "test-token";

      mockRedis.del.mockResolvedValue(1);

      await store.delete(token);

      expect(mockRedis.del).toHaveBeenCalledWith("token:test-token");
    });
  });

  describe("health", () => {
    it("should return true when Redis is healthy", async () => {
      mockRedis.ping.mockResolvedValue("PONG");

      const result = await store.health();

      expect(mockRedis.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when Redis is not healthy", async () => {
      mockRedis.ping.mockRejectedValue(new Error("Connection failed"));

      const result = await store.health();

      expect(mockRedis.ping).toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });

  describe("getUserTokens", () => {
    it("should return user tokens using SCAN", async () => {
      const userId = "user123";
      const data: TokenData = {
        sub: userId,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      // Mock SCAN results
      mockRedis.scan
        .mockResolvedValueOnce(["0", ["token:token1", "token:token2"]])
        .mockResolvedValueOnce(["0", []]);

      // Mock GET results
      mockRedis.pipeline.mockReturnValue({
        get: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, JSON.stringify(data)],
          [null, JSON.stringify({ ...data, sub: "other-user" })],
        ]),
      } as any);

      const result = await store.getUserTokens(userId);

      expect(mockRedis.scan).toHaveBeenCalledWith(
        "0",
        "MATCH",
        "token:*",
        "COUNT",
        100
      );
      expect(result).toHaveLength(1);
      expect(result[0].token).toBe("token1");
      expect(result[0].data.sub).toBe(userId);
    });
  });

  describe("revokeUserTokens", () => {
    it("should revoke all user tokens", async () => {
      const userId = "user123";
      const data: TokenData = {
        sub: userId,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      // Mock getUserTokens
      jest.spyOn(store, "getUserTokens").mockResolvedValue([
        { token: "token1", data },
        { token: "token2", data },
      ]);

      mockRedis.del.mockResolvedValue(2);

      const result = await store.revokeUserTokens(userId);

      expect(store.getUserTokens).toHaveBeenCalledWith(userId);
      expect(mockRedis.del).toHaveBeenCalledWith(
        "token:token1",
        "token:token2"
      );
      expect(result).toBe(2);
    });

    it("should return 0 when user has no tokens", async () => {
      const userId = "user123";

      jest.spyOn(store, "getUserTokens").mockResolvedValue([]);

      const result = await store.revokeUserTokens(userId);

      expect(store.getUserTokens).toHaveBeenCalledWith(userId);
      expect(mockRedis.del).not.toHaveBeenCalled();
      expect(result).toBe(0);
    });
  });

  describe("revokeTokensByDevice", () => {
    it("should revoke tokens for specific device", async () => {
      const userId = "user123";
      const deviceId = "device123";
      const data: TokenData = {
        sub: userId,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId },
      };

      // Mock getUserTokens
      jest.spyOn(store, "getUserTokens").mockResolvedValue([
        { token: "token1", data },
        {
          token: "token2",
          data: { ...data, meta: { deviceId: "other-device" } },
        },
      ]);

      mockRedis.del.mockResolvedValue(1);

      const result = await store.revokeTokensByDevice(userId, deviceId);

      expect(store.getUserTokens).toHaveBeenCalledWith(userId);
      expect(mockRedis.del).toHaveBeenCalledWith("token:token1");
      expect(result).toBe(1);
    });
  });

  describe("getUserDeviceTokens", () => {
    it("should return tokens for specific device", async () => {
      const userId = "user123";
      const deviceId = "device123";
      const data: TokenData = {
        sub: userId,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId },
      };

      // Mock getUserTokens
      jest.spyOn(store, "getUserTokens").mockResolvedValue([
        { token: "token1", data },
        {
          token: "token2",
          data: { ...data, meta: { deviceId: "other-device" } },
        },
      ]);

      const result = await store.getUserDeviceTokens(userId, deviceId);

      expect(store.getUserTokens).toHaveBeenCalledWith(userId);
      expect(result).toHaveLength(1);
      expect(result[0].token).toBe("token1");
      expect(result[0].data.meta.deviceId).toBe(deviceId);
    });
  });

  describe("getActiveTokenCount", () => {
    it("should return count of active tokens", async () => {
      // Mock SCAN results - first call returns some keys, second call returns empty with cursor "0"
      mockRedis.scan
        .mockResolvedValueOnce(["123", ["token:token1", "token:token2"]])
        .mockResolvedValueOnce(["0", ["token:token3"]]);

      const result = await store.getActiveTokenCount();

      expect(mockRedis.scan).toHaveBeenCalledTimes(2);
      expect(result).toBe(3);
    });
  });

  describe("cleanupExpiredTokens", () => {
    it("should clean up expired tokens", async () => {
      // Mock SCAN results
      mockRedis.scan
        .mockResolvedValueOnce(["0", ["token:token1", "token:token2"]])
        .mockResolvedValueOnce(["0", []]);

      // Mock TTL results (TTL = -2 means key doesn't exist)
      mockRedis.pipeline.mockReturnValue({
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 3600], // token1 exists
          [null, -2], // token2 expired
        ]),
      } as any);

      mockRedis.del.mockResolvedValue(1);

      const result = await store.cleanupExpiredTokens();

      expect(mockRedis.scan).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith("token:token2");
      expect(result).toBe(1);
    });
  });

  describe("custom key prefix", () => {
    it("should use custom key prefix", async () => {
      const customStore = new IoredisStore(mockRedis, { keyPrefix: "custom" });
      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      mockRedis.setex.mockResolvedValue("OK");

      await customStore.save(token, data, 3600);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "custom:test-token",
        3600,
        JSON.stringify(data)
      );
    });
  });
});

describe("createIoredisStore", () => {
  it("should create store with default options", () => {
    const mockRedis = new Redis() as jest.Mocked<Redis>;
    const store = createIoredisStore(mockRedis);

    expect(store).toBeInstanceOf(IoredisStore);
  });

  it("should create store with custom options", () => {
    const mockRedis = new Redis() as jest.Mocked<Redis>;
    const store = createIoredisStore(mockRedis, { keyPrefix: "custom" });

    expect(store).toBeInstanceOf(IoredisStore);
  });
});
