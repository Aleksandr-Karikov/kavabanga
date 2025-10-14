// ioredis-store.test.ts
import { IoredisStore, createIoredisStore } from "../index";
import {
  TokenData,
  TokenNotFoundError,
  TokenOperationError,
} from "@kavabanga/token-registry-core";
import Redis from "ioredis";
import { DEFAULT_PREFIX, LUA_SCRIPT_ERROR } from "../ioredis.adapter";

// Mock ioredis
jest.mock("ioredis");

describe("IoredisStore", () => {
  let store: IoredisStore;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRedis = new Redis() as jest.Mocked<Redis>;
    store = new IoredisStore(mockRedis);
  });

  describe("save", () => {
    it("should save token data with TTL", async () => {
      const token = "test-token-12345678";
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
        "token:test-token-12345678",
        ttl,
        JSON.stringify(data)
      );
    });

    it("should serialize complex token data correctly", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: 1234567890,
        expiresAt: 9876543210,
        meta: {
          deviceId: "device123",
          customField: "customValue",
          nestedObject: { key: "value", nested: { deep: "data" } },
          arrayField: [1, 2, 3],
        },
      };
      const ttl = 3600;

      mockRedis.setex.mockResolvedValue("OK");

      await store.save(token, data, ttl);

      const expectedSerialized = JSON.stringify(data);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        "token:test-token-12345678",
        ttl,
        expectedSerialized
      );
    });

    it("should throw TokenOperationError if Redis save fails", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      mockRedis.setex.mockRejectedValue(new Error("Redis connection error"));

      await expect(store.save(token, data, ttl)).rejects.toThrow(Error);
    });
  });

  describe("get", () => {
    it("should return token data when token exists", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(data));

      const result = await store.get(token);

      expect(mockRedis.get).toHaveBeenCalledWith("token:test-token-12345678");
      expect(result).toEqual(data);
    });

    it("should return null when token does not exist", async () => {
      const token = "non-existent-token";

      mockRedis.get.mockResolvedValue(null);

      const result = await store.get(token);

      expect(mockRedis.get).toHaveBeenCalledWith("token:non-existent-token");
      expect(result).toBeNull();
    });

    it("should deserialize complex token data correctly", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: 1234567890,
        expiresAt: 9876543210,
        meta: {
          deviceId: "device123",
          nestedObject: { key: "value" },
          arrayField: [1, 2, 3],
        },
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(data));

      const result = await store.get(token);

      expect(result).toEqual(data);
      expect(result!.meta.nestedObject).toEqual({ key: "value" });
      expect(result!.meta.arrayField).toEqual([1, 2, 3]);
    });

    it("should throw TokenOperationError if Redis get fails", async () => {
      const token = "test-token-12345678";

      mockRedis.get.mockRejectedValue(new Error("Redis connection error"));

      await expect(store.get(token)).rejects.toThrow(Error);
    });

    it("should throw TokenOperationError if JSON parsing fails", async () => {
      const token = "test-token-12345678";

      mockRedis.get.mockResolvedValue("invalid-json{{{");

      await expect(store.get(token)).rejects.toThrow(Error);
    });
  });

  describe("delete", () => {
    it("should delete token", async () => {
      const token = "test-token-12345678";

      mockRedis.del.mockResolvedValue(1);

      await store.delete(token);

      expect(mockRedis.del).toHaveBeenCalledWith("token:test-token-12345678");
    });

    it("should be idempotent (not throw when deleting non-existent token)", async () => {
      const token = "non-existent-token";

      mockRedis.del.mockResolvedValue(0); // Redis returns 0 when key doesn't exist

      await expect(store.delete(token)).resolves.not.toThrow();
    });

    it("should throw TokenOperationError if Redis delete fails", async () => {
      const token = "test-token-12345678";

      mockRedis.del.mockRejectedValue(new Error("Redis connection error"));

      await expect(store.delete(token)).rejects.toThrow(Error);
    });
  });

  describe("rotate", () => {
    it("should atomically rotate tokens using Lua script", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const newData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-new" },
      };
      const ttl = 3600;

      mockRedis.eval.mockResolvedValue("OK");

      await store.rotate(oldToken, newToken, newData, ttl);

      expect(mockRedis.eval).toHaveBeenCalledTimes(1);

      const callArgs = mockRedis.eval.mock.calls[0];
      const luaScript = callArgs[0] as string;

      expect(luaScript).toContain("redis.call('EXISTS', KEYS[1])");
      expect(luaScript).toContain("redis.call('DEL', KEYS[1])");
      expect(luaScript).toContain("redis.call('SET', KEYS[2]");

      expect(callArgs[1]).toBe(2); 
      expect(callArgs[2]).toBe("token:old-token-12345678"); // oldKey
      expect(callArgs[3]).toBe("token:new-token-87654321"); // newKey
      expect(callArgs[4]).toBe(JSON.stringify(newData)); // serialized data
      expect(callArgs[5]).toBe(ttl.toString()); // TTL
    });

    it("should throw TokenNotFoundError if old token does not exist", async () => {
      const oldToken = "non-existent-old";
      const newToken = "new-token-87654321";
      const newData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-new" },
      };

      mockRedis.eval.mockRejectedValue(
        new Error(LUA_SCRIPT_ERROR.OLD_TOKEN_NOT_FOUND)
      );

      await expect(
        store.rotate(oldToken, newToken, newData, 3600)
      ).rejects.toThrow(TokenNotFoundError);
    });

    it("should throw TokenOperationError if new token already exists", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "existing-new-token";
      const newData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-new" },
      };

      // Mock Lua script возвращает ошибку "New token already exists"
      mockRedis.eval.mockRejectedValue(new Error("New token already exists"));

      await expect(
        store.rotate(oldToken, newToken, newData, 3600)
      ).rejects.toThrow(TokenOperationError);
    });

    it("should throw TokenOperationError if rotation fails", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const newData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-new" },
      };

      mockRedis.eval.mockRejectedValue(new Error("Redis connection lost"));

      await expect(
        store.rotate(oldToken, newToken, newData, 3600)
      ).rejects.toThrow(TokenOperationError);
    });

    it("should handle complex token data in rotation", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const newData: TokenData = {
        sub: "user123",
        issuedAt: 1234567890,
        expiresAt: 9876543210,
        meta: {
          deviceId: "device-new",
          customField: "value",
          nestedObject: { key: "value" },
          arrayField: [1, 2, 3],
        },
      };
      const ttl = 7200;

      mockRedis.eval.mockResolvedValue("OK");

      await store.rotate(oldToken, newToken, newData, ttl);

      const callArgs = mockRedis.eval.mock.calls[0];
      const serializedData = callArgs[4] as string;

      expect(JSON.parse(serializedData)).toEqual(newData);
      expect(callArgs[5]).toBe("7200");
    });

    it("should use correct key prefix in rotation", async () => {
      const customStore = new IoredisStore(mockRedis, { keyPrefix: "custom" });
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const newData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-new" },
      };

      mockRedis.eval.mockResolvedValue("OK");

      await customStore.rotate(oldToken, newToken, newData, 3600);

      const callArgs = mockRedis.eval.mock.calls[0];
      expect(callArgs[2]).toBe("custom:old-token-12345678");
      expect(callArgs[3]).toBe("custom:new-token-87654321");
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

    it("should return false when Redis ping returns unexpected response", async () => {
      mockRedis.ping.mockResolvedValue("UNEXPECTED" as any);

      const result = await store.health();

      expect(result).toBe(false);
    });
  });

  describe("custom key prefix", () => {
    it("should use custom key prefix for save", async () => {
      const customStore = new IoredisStore(mockRedis, { keyPrefix: "custom" });
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      mockRedis.setex.mockResolvedValue("OK");

      await customStore.save(token, data, 3600);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        "custom:test-token-12345678",
        3600,
        JSON.stringify(data)
      );
    });

    it("should use custom key prefix for get", async () => {
      const customStore = new IoredisStore(mockRedis, { keyPrefix: "custom" });
      const token = "test-token-12345678";

      mockRedis.get.mockResolvedValue(null);

      await customStore.get(token);

      expect(mockRedis.get).toHaveBeenCalledWith("custom:test-token-12345678");
    });

    it("should use custom key prefix for delete", async () => {
      const customStore = new IoredisStore(mockRedis, { keyPrefix: "custom" });
      const token = "test-token-12345678";

      mockRedis.del.mockResolvedValue(1);

      await customStore.delete(token);

      expect(mockRedis.del).toHaveBeenCalledWith("custom:test-token-12345678");
    });

    it("should handle empty prefix", async () => {
      const customStore = new IoredisStore(mockRedis, { keyPrefix: "" });
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      mockRedis.setex.mockResolvedValue("OK");

      await customStore.save(token, data, 3600);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `${DEFAULT_PREFIX}:test-token-12345678`,
        3600,
        JSON.stringify(data)
      );
    });
  });

  describe("IoredisStore - error handling", () => {
    it("should throw Redis error as is for connection failures", async () => {
      const connectionError = new Error("Connection refused");
      (connectionError as any).code = "ECONNREFUSED";
      mockRedis.setex.mockRejectedValue(connectionError);

      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      try {
        await store.save(token, data, 3600);
        fail("Should have thrown error");
      } catch (error) {
        // Redis ошибка пробросилась как есть
        expect(error).toBe(connectionError);
        expect((error as any).code).toBe("ECONNREFUSED");
      }
    });

    it("should throw Redis error as is for timeout", async () => {
      const timeoutError = new Error("Command timed out");
      (timeoutError as any).code = "ETIMEDOUT";
      mockRedis.get.mockRejectedValue(timeoutError);

      try {
        await store.get("test-token");
        fail("Should have thrown error");
      } catch (error) {
        // Redis ошибка пробросилась как есть
        expect(error).toBe(timeoutError);
        expect((error as any).code).toBe("ETIMEDOUT");
      }
    });

    it("should wrap JSON parsing error in TokenOperationError", async () => {
      mockRedis.get.mockResolvedValue("invalid-json{{{");

      try {
        await store.get("test-token");
        fail("Should have thrown error");
      } catch (error) {
        // Ошибка парсинга обернута
        expect(error).toBeInstanceOf(TokenOperationError);
        expect(
          (error as TokenOperationError).context?.parseError
        ).toBeDefined();
      }
    });
  });

  describe("concurrent operations", () => {
    it("should handle concurrent saves to different tokens", async () => {
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      mockRedis.setex.mockResolvedValue("OK");

      const tokens = Array.from({ length: 10 }, (_, i) => `token-${i}`);

      await Promise.all(tokens.map((token) => store.save(token, data, 3600)));

      expect(mockRedis.setex).toHaveBeenCalledTimes(10);
    });

    it("should handle concurrent operations on same token", async () => {
      const token = "concurrent-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      mockRedis.setex.mockResolvedValue("OK");

      // Множественные одновременные сохранения
      await Promise.all(
        Array.from({ length: 5 }, () => store.save(token, data, 3600))
      );

      expect(mockRedis.setex).toHaveBeenCalledTimes(5);
      // Все вызовы должны быть с одним ключом
      mockRedis.setex.mock.calls.forEach((call) => {
        expect(call[0]).toBe("token:concurrent-token");
      });
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

  it("should create store with empty prefix", () => {
    const mockRedis = new Redis() as jest.Mocked<Redis>;
    const store = createIoredisStore(mockRedis, { keyPrefix: "" });

    expect(store).toBeInstanceOf(IoredisStore);
  });

  it("should create independent store instances", () => {
    const mockRedis1 = new Redis() as jest.Mocked<Redis>;
    const mockRedis2 = new Redis() as jest.Mocked<Redis>;

    const store1 = createIoredisStore(mockRedis1, { keyPrefix: "store1" });
    const store2 = createIoredisStore(mockRedis2, { keyPrefix: "store2" });

    expect(store1).not.toBe(store2);
  });
});

describe("IoredisStore integration patterns", () => {
  let store: IoredisStore;
  let mockRedis: jest.Mocked<Redis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = new Redis() as jest.Mocked<Redis>;
    store = new IoredisStore(mockRedis);
  });

  it("should handle full token lifecycle", async () => {
    const token = "lifecycle-token-12345678";
    const data: TokenData = {
      sub: "user123",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: { deviceId: "device123" },
    };

    // Save
    mockRedis.setex.mockResolvedValue("OK");
    await store.save(token, data, 3600);
    expect(mockRedis.setex).toHaveBeenCalled();

    // Get
    mockRedis.get.mockResolvedValue(JSON.stringify(data));
    const retrieved = await store.get(token);
    expect(retrieved).toEqual(data);

    // Delete
    mockRedis.del.mockResolvedValue(1);
    await store.delete(token);
    expect(mockRedis.del).toHaveBeenCalled();

    // Verify deleted
    mockRedis.get.mockResolvedValue(null);
    const afterDelete = await store.get(token);
    expect(afterDelete).toBeNull();
  });

  it("should handle token rotation lifecycle", async () => {
    const oldToken = "old-lifecycle-token-12345";
    const newToken = "new-lifecycle-token-67890";
    const oldData: TokenData = {
      sub: "user123",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: { deviceId: "device-old", version: 1 },
    };
    const newData: TokenData = {
      sub: "user123",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: { deviceId: "device-new", version: 2 },
    };

    // Create old token
    mockRedis.setex.mockResolvedValue("OK");
    await store.save(oldToken, oldData, 3600);

    // Rotate
    mockRedis.eval.mockResolvedValue("OK");
    await store.rotate(oldToken, newToken, newData, 3600);

    // Verify rotation in Lua script call
    expect(mockRedis.eval).toHaveBeenCalledTimes(1);
    const callArgs = mockRedis.eval.mock.calls[0];
    expect(callArgs[2]).toBe("token:old-lifecycle-token-12345");
    expect(callArgs[3]).toBe("token:new-lifecycle-token-67890");
  });
});
