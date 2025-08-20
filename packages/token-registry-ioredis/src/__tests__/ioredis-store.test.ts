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
