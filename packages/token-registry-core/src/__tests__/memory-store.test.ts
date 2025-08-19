import {
  InMemoryStore,
  createMemoryStore,
  createTestMemoryStore,
  TokenData,
} from "../index";

describe("InMemoryStore", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  describe("save", () => {
    it("should save token data", async () => {
      const token = "test-token";
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
      const token = "test-token";
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
  });

  describe("get", () => {
    it("should return null for non-existent token", async () => {
      const result = await store.get("non-existent");
      expect(result).toBeNull();
    });

    it("should return saved token data", async () => {
      const token = "test-token";
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
  });

  describe("delete", () => {
    it("should delete existing token", async () => {
      const token = "test-token";
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

    it("should not throw when deleting non-existent token", async () => {
      await expect(store.delete("non-existent")).resolves.not.toThrow();
    });
  });

  describe("health", () => {
    it("should always return true", async () => {
      const isHealthy = await store.health();
      expect(isHealthy).toBe(true);
    });
  });

  describe("TTL expiration", () => {
    it("should automatically expire tokens after TTL", async () => {
      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };
      const ttl = 0.1; // 100ms

      await store.save(token, data, ttl);

      // Token should exist immediately
      let retrieved = await store.get(token);
      expect(retrieved).toEqual(data);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Token should be expired
      retrieved = await store.get(token);
      expect(retrieved).toBeNull();
    });
  });

  describe("utility methods", () => {
    it("should return correct active token count", async () => {
      expect(store.getActiveTokenCount()).toBe(0);

      const token1 = "token1";
      const token2 = "token2";
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
    });

    it("should return list of active tokens", async () => {
      const token1 = "token1";
      const token2 = "token2";
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

    it("should clear all tokens", async () => {
      const token1 = "token1";
      const token2 = "token2";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token1, data, 3600);
      await store.save(token2, data, 3600);

      expect(store.getActiveTokenCount()).toBe(2);

      store.clear();

      expect(store.getActiveTokenCount()).toBe(0);
      expect(await store.get(token1)).toBeNull();
      expect(await store.get(token2)).toBeNull();
    });

    it("should forcibly expire token", async () => {
      const token = "test-token";
      const data: TokenData = {
        sub: "user123",
        issuedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        meta: { deviceId: "device123" },
      };

      await store.save(token, data, 3600);
      expect(await store.get(token)).toEqual(data);

      const result = store.expireToken(token);
      expect(result).toBe(true);
      expect(await store.get(token)).toBeNull();
    });

    it("should return false when expiring non-existent token", async () => {
      const result = store.expireToken("non-existent");
      expect(result).toBe(false);
    });
  });
});

describe("createMemoryStore", () => {
  it("should create a new InMemoryStore instance", () => {
    const store = createMemoryStore();
    expect(store).toBeInstanceOf(InMemoryStore);
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
    const token = "test-token";
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
});
