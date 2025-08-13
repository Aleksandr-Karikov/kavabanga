import {
  InMemoryStoreAdapter,
  createDevelopmentMemoryAdapter,
  createTestMemoryAdapter,
} from "../../adapters/memory.adapter";
import { TokenSaveRequest, TokenData } from "../../core/interfaces";

const createTestRequest = (): TokenSaveRequest => ({
  token: "test-token-123",
  data: {
    sub: "user123",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    meta: {
      deviceId: "device123",
      ipAddress: "192.168.1.1",
    },
  },
  ttl: 60, // 1 minute
});

describe("InMemoryStoreAdapter", () => {
  let adapter: InMemoryStoreAdapter;

  beforeEach(() => {
    adapter = new InMemoryStoreAdapter();
  });

  afterEach(() => {
    adapter.clear();
  });

  describe("saveToken", () => {
    it("should save token successfully", async () => {
      const request = createTestRequest();

      await expect(adapter.saveToken(request)).resolves.not.toThrow();

      const data = await adapter.getTokenData(request.token);
      expect(data).toEqual(request.data);
    });

    it("should set up automatic expiration timer", async () => {
      jest.useFakeTimers();

      const request = createTestRequest();
      request.ttl = 1; // 1 second

      await adapter.saveToken(request);

      // Token should exist immediately
      let data = await adapter.getTokenData(request.token);
      expect(data).toEqual(request.data);

      // Fast-forward time
      jest.advanceTimersByTime(1100);

      // Token should be expired and removed
      data = await adapter.getTokenData(request.token);
      expect(data).toBeNull();

      jest.useRealTimers();
    });

    it("should replace existing token", async () => {
      const request1 = createTestRequest();
      const request2 = {
        ...createTestRequest(),
        data: {
          ...createTestRequest().data,
          sub: "user456",
        },
      };

      await adapter.saveToken(request1);
      await adapter.saveToken(request2);

      const data = await adapter.getTokenData(request1.token);
      expect(data?.sub).toBe("user456");
    });

    it("should clear existing timer when replacing token", async () => {
      jest.useFakeTimers();

      const request1 = createTestRequest();
      request1.ttl = 1;

      const request2 = createTestRequest();
      request2.ttl = 10;

      await adapter.saveToken(request1);

      // Replace token before first expires
      jest.advanceTimersByTime(500);
      await adapter.saveToken(request2);

      // First timer should be cleared, token should still exist after 1 second
      jest.advanceTimersByTime(600);
      const data = await adapter.getTokenData(request1.token);
      expect(data).not.toBeNull();

      jest.useRealTimers();
    });
  });

  describe("getTokenData", () => {
    it("should return token data if exists", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      const data = await adapter.getTokenData(request.token);
      expect(data).toEqual(request.data);
    });

    it("should return null if token does not exist", async () => {
      const data = await adapter.getTokenData("non-existent-token");
      expect(data).toBeNull();
    });

    it("should validate token parameter", async () => {
      await expect(adapter.getTokenData("")).rejects.toThrow();
      await expect(adapter.getTokenData(null as any)).rejects.toThrow();
    });
  });

  describe("deleteToken", () => {
    it("should delete existing token", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      await adapter.deleteToken(request.token);

      const data = await adapter.getTokenData(request.token);
      expect(data).toBeNull();
    });

    it("should clear associated timer when deleting", async () => {
      jest.useFakeTimers();

      const request = createTestRequest();
      request.ttl = 10;

      await adapter.saveToken(request);
      await adapter.deleteToken(request.token);

      // Even after TTL expires, token should remain deleted
      jest.advanceTimersByTime(11000);

      const data = await adapter.getTokenData(request.token);
      expect(data).toBeNull();

      jest.useRealTimers();
    });

    it("should not throw if token does not exist", async () => {
      await expect(
        adapter.deleteToken("non-existent-token")
      ).resolves.not.toThrow();
    });
  });

  describe("isHealthy", () => {
    it("should always return true", async () => {
      const isHealthy = await adapter.isHealthy();
      expect(isHealthy).toBe(true);
    });
  });

  describe("utility methods", () => {
    it("should return active token count", async () => {
      expect(adapter.getActiveTokenCount()).toBe(0);

      await adapter.saveToken(createTestRequest());
      expect(adapter.getActiveTokenCount()).toBe(1);

      await adapter.saveToken({ ...createTestRequest(), token: "token2" });
      expect(adapter.getActiveTokenCount()).toBe(2);
    });

    it("should return active token list", async () => {
      const request1 = createTestRequest();
      const request2 = { ...createTestRequest(), token: "token2" };

      await adapter.saveToken(request1);
      await adapter.saveToken(request2);

      const tokens = adapter.getActiveTokens();
      expect(tokens).toContain(request1.token);
      expect(tokens).toContain(request2.token);
      expect(tokens.length).toBe(2);
    });

    it("should return timer information", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      const timersInfo = adapter.getTimersInfo();
      expect(timersInfo).toEqual([{ token: request.token, hasTimer: true }]);
    });

    it("should clear all tokens and timers", async () => {
      await adapter.saveToken(createTestRequest());
      await adapter.saveToken({ ...createTestRequest(), token: "token2" });

      adapter.clear();

      expect(adapter.getActiveTokenCount()).toBe(0);
      expect(adapter.getActiveTokens()).toEqual([]);
    });

    it("should forcibly expire token", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      const expired = adapter.expireToken(request.token);
      expect(expired).toBe(true);

      const data = await adapter.getTokenData(request.token);
      expect(data).toBeNull();
    });

    it("should return false when expiring non-existent token", () => {
      const expired = adapter.expireToken("non-existent");
      expect(expired).toBe(false);
    });

    it("should return statistics", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      const stats = adapter.getStats();
      expect(stats).toEqual({
        totalTokens: 1,
        activeTimers: 1,
        memoryUsage: expect.stringMatching(/\d+(\.\d+)?\s+(Bytes|KB|MB|GB)/),
      });
    });
  });

  describe("error handling", () => {
    it("should handle errors gracefully", async () => {
      // Create a scenario that might cause an error
      const adapter = new InMemoryStoreAdapter();

      // Mock console.error to avoid noise in test output
      const originalError = console.error;
      console.error = jest.fn();

      try {
        // These should not throw even with invalid inputs
        await expect(adapter.getTokenData(null as any)).rejects.toThrow();
      } finally {
        console.error = originalError;
      }
    });
  });
});

describe("Factory Functions", () => {
  describe("createDevelopmentMemoryAdapter", () => {
    it("should create InMemoryStoreAdapter instance", () => {
      const adapter = createDevelopmentMemoryAdapter();
      expect(adapter).toBeInstanceOf(InMemoryStoreAdapter);
    });
  });

  describe("createTestMemoryAdapter", () => {
    it("should create InMemoryStoreAdapter with additional test methods", () => {
      const adapter = createTestMemoryAdapter();
      expect(adapter).toBeInstanceOf(InMemoryStoreAdapter);

      // Check if additional test methods are added
      expect((adapter as any).getAllTokensWithData).toBeDefined();
      expect(typeof (adapter as any).getAllTokensWithData).toBe("function");
    });

    it("should provide getAllTokensWithData method", async () => {
      const adapter = createTestMemoryAdapter();

      const request = createTestRequest();
      await adapter.saveToken(request);

      const allTokens = (adapter as any).getAllTokensWithData();
      expect(allTokens).toEqual([
        {
          token: request.token,
          data: request.data,
          hasTimer: true,
        },
      ]);
    });
  });
});
