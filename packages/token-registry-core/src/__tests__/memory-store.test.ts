import {
  InMemoryStore,
  createMemoryStore,
  createTestMemoryStore,
  TokenData,
  TokenNotFoundError,
  TokenOperationError,
} from "../index";

describe("InMemoryStore", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterEach(() => {
    store.clear();
  });

  describe("save", () => {
    it("should save token data", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await store.save(token, data, ttl);
      const retrieved = await store.get(token);

      expect(retrieved).toEqual(data);
    });

    it("should overwrite existing token", async () => {
      const token = "test-token-12345678";
      const data1: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const data2: TokenData = {
        sub: "user456",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device456" },
      };
      const ttl = 3600;

      await store.save(token, data1, ttl);
      await store.save(token, data2, ttl);

      const retrieved = await store.get(token);
      expect(retrieved).toEqual(data2);
    });

    it("should create expiration timer", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token, data, 3600);

      expect((store as any).timers.has(token)).toBe(true);
    });

    it("should clear existing timer when overwriting token", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token, data, 0.1);

      await store.save(token, data, 3600);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const retrieved = await store.get(token);
      expect(retrieved).toEqual(data);
    });

    it("should handle maximum TTL value", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        meta: { deviceId: "device123" },
      };

      const ttl = 365 * 24 * 60 * 60;

      await store.save(token, data, ttl);

      const retrieved = await store.get(token);
      expect(retrieved).toEqual(data);

      expect((store as any).timers.has(token)).toBe(true);
    });
  });

  describe("get", () => {
    it("should return null for non-existent token", async () => {
      const result = await store.get("non-existent");
      expect(result).toBeNull();
    });

    it("should return saved token data", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await store.save(token, data, ttl);
      const retrieved = await store.get(token);

      expect(retrieved).toEqual(data);
    });

    it("should return exact same object structure", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: 1234567890,
        expiresAt: 9876543210,
        meta: {
          deviceId: "device123",
          customField: "customValue",
          nestedObject: { key: "value" },
        },
      };

      await store.save(token, data, 3600);
      const retrieved = await store.get(token);

      expect(retrieved).toStrictEqual(data);
    });
  });

  describe("delete", () => {
    it("should delete existing token", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 3600;

      await store.save(token, data, ttl);
      await store.delete(token);

      const retrieved = await store.get(token);
      expect(retrieved).toBeNull();
    });

    it("should be idempotent (not throw when deleting non-existent token)", async () => {
      await expect(store.delete("non-existent")).resolves.not.toThrow();

      await store.delete("non-existent");
      await store.delete("non-existent");
    });

    it("should clear timer when deleting token", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token, data, 3600);

      expect((store as any).timers.has(token)).toBe(true);

      await store.delete(token);

      expect((store as any).timers.has(token)).toBe(false);

      expect((store as any).tokens.has(token)).toBe(false);
    });
  });

  describe("rotate", () => {
    it("should atomically rotate tokens", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const oldData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-old" },
      };
      const newData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-new" },
      };
      const ttl = 3600;

      await store.save(oldToken, oldData, ttl);
      await store.rotate(oldToken, newToken, newData, ttl);

      const oldResult = await store.get(oldToken);
      const newResult = await store.get(newToken);

      expect(oldResult).toBeNull();
      expect(newResult).toEqual(newData);
    });

    it("should throw TokenNotFoundError if old token does not exist in store", async () => {
      const oldToken = "non-existent-old";
      const newToken = "new-token-87654321";
      const newData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-new" },
      };

      await expect(
        store.rotate(oldToken, newToken, newData, 3600)
      ).rejects.toThrow(TokenNotFoundError);
    });

    it("should throw TokenOperationError if new token already exists in store", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const tokenData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(oldToken, tokenData, 3600);
      await store.save(newToken, tokenData, 3600);

      await expect(
        store.rotate(oldToken, newToken, tokenData, 3600)
      ).rejects.toThrow(TokenOperationError);

      await expect(
        store.rotate(oldToken, newToken, tokenData, 3600)
      ).rejects.toThrow("New token already exists in store");
    });

    it("should rollback if operation fails during atomic section", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const oldData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-old" },
      };

      await store.save(oldToken, oldData, 3600);

      const originalSet = Map.prototype.set;
      let callCount = 0;
      Map.prototype.set = jest.fn(function (
        this: Map<any, any>,
        key: any,
        value: any
      ) {
        callCount++;
        if (callCount === 2) {
          throw new Error("Storage error");
        }
        return originalSet.call(this, key, value);
      });

      await expect(
        store.rotate(oldToken, newToken, oldData, 3600)
      ).rejects.toThrow(TokenOperationError);

      Map.prototype.set = originalSet;

      const oldResult = await store.get(oldToken);
      expect(oldResult).toEqual(oldData);

      const newResult = await store.get(newToken);
      expect(newResult).toBeNull();
    });

    it("should properly manage timers during rotation", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const oldData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-old" },
      };
      const newData: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device-new" },
      };

      await store.save(oldToken, oldData, 3600);

      expect((store as any).timers.has(oldToken)).toBe(true);
      expect((store as any).timers.has(newToken)).toBe(false);

      await store.rotate(oldToken, newToken, newData, 3600);

      expect((store as any).timers.has(oldToken)).toBe(false);
      expect((store as any).timers.has(newToken)).toBe(true);
    });

    it("should restore timer during rollback", async () => {
      const oldToken = "old-token-12345678";
      const newToken = "new-token-87654321";
      const oldData: TokenData = {
        sub: "user123",
        issuedAt: Date.now() - 1000,
        expiresAt: Date.now() + 10000,
        meta: { deviceId: "device-old" },
      };

      await store.save(oldToken, oldData, 3600);

      const originalSet = Map.prototype.set;
      let callCount = 0;
      Map.prototype.set = jest.fn(function (
        this: Map<any, any>,
        key: any,
        value: any
      ) {
        callCount++;
        if (callCount === 2) {
          throw new Error("Storage error");
        }
        return originalSet.call(this, key, value);
      });

      await expect(
        store.rotate(oldToken, newToken, oldData, 3600)
      ).rejects.toThrow();

      Map.prototype.set = originalSet;

      expect((store as any).tokens.has(oldToken)).toBe(true);
      expect((store as any).timers.has(oldToken)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 5000));
      expect(await store.get(oldToken)).not.toBeNull();
    }, 15000);

    it("should handle multiple consecutive rotations", async () => {
      const token1 = "token-1-12345678";
      const token2 = "token-2-87654321";
      const token3 = "token-3-abcdefgh";

      const data1: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { version: 1 },
      };

      const data2: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { version: 2 },
      };

      const data3: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { version: 3 },
      };

      await store.save(token1, data1, 3600);
      await store.rotate(token1, token2, data2, 3600);

      expect(await store.get(token1)).toBeNull();
      expect(await store.get(token2)).toEqual(data2);

      await store.rotate(token2, token3, data3, 3600);

      expect(await store.get(token2)).toBeNull();
      expect(await store.get(token3)).toEqual(data3);

      expect(store.getActiveTokenCount()).toBe(1);
      expect(store.getActiveTokens()).toEqual([token3]);
    });
  });

  describe("health", () => {
    it("should always return true for in-memory store", async () => {
      const isHealthy = await store.health();
      expect(isHealthy).toBe(true);
    });

    it("should return true even with many tokens", async () => {
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      for (let i = 0; i < 1000; i++) {
        await store.save(`token-${i}`, data, 3600);
      }

      const isHealthy = await store.health();
      expect(isHealthy).toBe(true);
    });
  });

  describe("TTL expiration", () => {
    it("should automatically expire tokens after TTL", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 200,
        meta: { deviceId: "device123" },
      };
      const ttl = 0.1; // 100ms

      await store.save(token, data, ttl);

      // Token should exist immediately
      let retrieved = await store.get(token);
      expect(retrieved).toEqual(data);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Token should be expired and removed from store
      retrieved = await store.get(token);
      expect(retrieved).toBeNull();

      // Timer should be cleaned up
      expect((store as any).timers.has(token)).toBe(false);
    });

    it("should not expire token before TTL", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 1; // 1 second

      await store.save(token, data, ttl);

      // Wait less than TTL
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Token should still exist
      const retrieved = await store.get(token);
      expect(retrieved).toEqual(data);
    });

    it("should cap extremely large TTL values", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        meta: { deviceId: "device123" },
      };

      const ttl = 365 * 24 * 60 * 60;

      await expect(store.save(token, data, ttl)).resolves.not.toThrow();

      const retrieved = await store.get(token);
      expect(retrieved).toEqual(data);

      expect((store as any).timers.has(token)).toBe(true);
    });
  });

  describe("utility methods", () => {
    it("should return correct active token count", async () => {
      expect(store.getActiveTokenCount()).toBe(0);

      const token1 = "token1-12345678";
      const token2 = "token2-87654321";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token1, data, 3600);
      expect(store.getActiveTokenCount()).toBe(1);

      await store.save(token2, data, 3600);
      expect(store.getActiveTokenCount()).toBe(2);

      await store.delete(token1);
      expect(store.getActiveTokenCount()).toBe(1);

      await store.delete(token2);
      expect(store.getActiveTokenCount()).toBe(0);
    });

    it("should return list of active tokens", async () => {
      const token1 = "token1-12345678";
      const token2 = "token2-87654321";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token1, data, 3600);
      await store.save(token2, data, 3600);

      const activeTokens = store.getActiveTokens();
      expect(activeTokens).toContain(token1);
      expect(activeTokens).toContain(token2);
      expect(activeTokens).toHaveLength(2);
    });

    it("should clear all tokens and timers", async () => {
      const token1 = "token1-12345678";
      const token2 = "token2-87654321";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token1, data, 3600);
      await store.save(token2, data, 3600);

      expect(store.getActiveTokenCount()).toBe(2);
      expect((store as any).timers.size).toBe(2);

      store.clear();

      expect(store.getActiveTokenCount()).toBe(0);
      expect((store as any).timers.size).toBe(0);
      expect(await store.get(token1)).toBeNull();
      expect(await store.get(token2)).toBeNull();
    });

    it("should forcibly expire token", async () => {
      const token = "test-token-12345678";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token, data, 3600);
      expect(await store.get(token)).toEqual(data);
      expect((store as any).timers.has(token)).toBe(true);

      const result = store.expireToken(token);

      expect(result).toBe(true);
      expect(await store.get(token)).toBeNull();
      expect((store as any).timers.has(token)).toBe(false);
    });

    it("should return false when expiring non-existent token", async () => {
      const result = store.expireToken("non-existent");
      expect(result).toBe(false);
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

      const tokens = Array.from({ length: 100 }, (_, i) => `token-${i}`);

      await Promise.all(tokens.map((token) => store.save(token, data, 3600)));

      expect(store.getActiveTokenCount()).toBe(100);

      const results = await Promise.all(
        tokens.map((token) => store.get(token))
      );

      expect(results.every((r) => r !== null)).toBe(true);
    });

    it("should handle concurrent operations on same token", async () => {
      const token = "concurrent-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token, data, 3600);

      const operations = Array.from({ length: 10 }, (_, i) => ({
        ...data,
        meta: { ...data.meta, version: i },
      }));

      await Promise.all(operations.map((d) => store.save(token, d, 3600)));

      expect(store.getActiveTokenCount()).toBe(1);

      const retrieved = await store.get(token);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sub).toBe("user123");
    });
  });
});

describe("createMemoryStore", () => {
  it("should create a new InMemoryStore instance", () => {
    const store = createMemoryStore();
    expect(store).toBeInstanceOf(InMemoryStore);
  });

  it("should create independent instances", () => {
    const store1 = createMemoryStore();
    const store2 = createMemoryStore();

    expect(store1).not.toBe(store2);

    const data: TokenData = {
      sub: "user123",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: {},
    };

    store1.save("token", data, 3600);

    expect(store1.getActiveTokenCount()).toBe(1);
    expect(store2.getActiveTokenCount()).toBe(0);
  });
});

describe("createTestMemoryStore", () => {
  it("should create a test store with additional methods", () => {
    const store = createTestMemoryStore();
    expect(store).toBeInstanceOf(InMemoryStore);
    expect((store as any).getAllTokensWithData).toBeDefined();
  });

  it("should provide getAllTokensWithData method", async () => {
    const store = createTestMemoryStore();
    const token = "test-token-12345678";
    const data: TokenData = {
      sub: "user123",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: { deviceId: "device123" },
    };

    await store.save(token, data, 3600);

    const allTokens = (store as any).getAllTokensWithData();
    expect(allTokens).toHaveLength(1);
    expect(allTokens[0].token).toBe(token);
    expect(allTokens[0].data).toEqual(data);
    expect(allTokens[0].hasTimer).toBe(true);
  });

  it("should track timers correctly in test utilities", async () => {
    const store = createTestMemoryStore();
    const token1 = "token1-12345678";
    const token2 = "token2-87654321";
    const data: TokenData = {
      sub: "user123",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: {},
    };

    await store.save(token1, data, 3600);
    await store.save(token2, data, 3600);

    await store.delete(token1);

    const allTokens = (store as any).getAllTokensWithData();
    expect(allTokens).toHaveLength(1);
    expect(allTokens[0].token).toBe(token2);
    expect(allTokens[0].hasTimer).toBe(true);
  });
});
