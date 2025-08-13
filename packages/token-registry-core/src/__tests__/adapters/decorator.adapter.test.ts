import { StoreAdapterDecorator } from "../../adapters/decorator.adapter";
import { InMemoryStoreAdapter } from "../../adapters/memory.adapter";
import {
  ITokenStoreAdapter,
  TokenSaveRequest,
  TokenData,
} from "../../core/interfaces";

class TestDecorator extends StoreAdapterDecorator {
  public saveTokenCalled = false;
  public getTokenDataCalled = false;
  public deleteTokenCalled = false;
  public isHealthyCalled = false;

  async saveToken(request: TokenSaveRequest): Promise<void> {
    this.saveTokenCalled = true;
    return super.saveToken(request);
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    this.getTokenDataCalled = true;
    return super.getTokenData(token);
  }

  async deleteToken(token: string): Promise<void> {
    this.deleteTokenCalled = true;
    return super.deleteToken(token);
  }

  async isHealthy(): Promise<boolean> {
    this.isHealthyCalled = true;
    return super.isHealthy();
  }

  // Expose protected methods for testing
  public testGetWrapped(): ITokenStoreAdapter {
    return this.getWrapped();
  }

  public testGetInnerMost(): ITokenStoreAdapter {
    return this.getInnerMost();
  }
}

class LoggingDecorator extends StoreAdapterDecorator {
  public logs: string[] = [];

  async saveToken(request: TokenSaveRequest): Promise<void> {
    this.logs.push(`Saving token: ${request.token}`);
    await super.saveToken(request);
    this.logs.push(`Saved token: ${request.token}`);
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    this.logs.push(`Getting token: ${token}`);
    const result = await super.getTokenData(token);
    this.logs.push(`Got token: ${token} (${result ? "found" : "not found"})`);
    return result;
  }

  async deleteToken(token: string): Promise<void> {
    this.logs.push(`Deleting token: ${token}`);
    await super.deleteToken(token);
    this.logs.push(`Deleted token: ${token}`);
  }
}

const createTestRequest = (): TokenSaveRequest => ({
  token: "test-token-123",
  data: {
    sub: "user123",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    meta: {
      deviceId: "device123",
    },
  },
  ttl: 60,
});

describe("StoreAdapterDecorator", () => {
  let baseAdapter: InMemoryStoreAdapter;
  let decorator: TestDecorator;

  beforeEach(() => {
    baseAdapter = new InMemoryStoreAdapter();
    decorator = new TestDecorator(baseAdapter);
  });

  afterEach(() => {
    baseAdapter.clear();
  });

  describe("constructor", () => {
    it("should accept wrapped adapter", () => {
      expect(decorator.testGetWrapped()).toBe(baseAdapter);
    });

    it("should throw when wrapped adapter is null", () => {
      expect(() => new TestDecorator(null as any)).toThrow(
        "Wrapped adapter is required"
      );
    });

    it("should throw when wrapped adapter is undefined", () => {
      expect(() => new TestDecorator(undefined as any)).toThrow(
        "Wrapped adapter is required"
      );
    });
  });

  describe("delegation to wrapped adapter", () => {
    it("should delegate saveToken to wrapped adapter", async () => {
      const request = createTestRequest();

      await decorator.saveToken(request);

      expect(decorator.saveTokenCalled).toBe(true);

      // Verify data was actually saved to base adapter
      const data = await baseAdapter.getTokenData(request.token);
      expect(data).toEqual(request.data);
    });

    it("should delegate getTokenData to wrapped adapter", async () => {
      const request = createTestRequest();
      await baseAdapter.saveToken(request);

      const data = await decorator.getTokenData(request.token);

      expect(decorator.getTokenDataCalled).toBe(true);
      expect(data).toEqual(request.data);
    });

    it("should delegate deleteToken to wrapped adapter", async () => {
      const request = createTestRequest();
      await baseAdapter.saveToken(request);

      await decorator.deleteToken(request.token);

      expect(decorator.deleteTokenCalled).toBe(true);

      // Verify token was actually deleted from base adapter
      const data = await baseAdapter.getTokenData(request.token);
      expect(data).toBeNull();
    });

    it("should delegate isHealthy to wrapped adapter", async () => {
      const health = await decorator.isHealthy();

      expect(decorator.isHealthyCalled).toBe(true);
      expect(health).toBe(true);
    });
  });

  describe("decorator chain navigation", () => {
    it("should return immediate wrapped adapter", () => {
      const wrapped = decorator.testGetWrapped();
      expect(wrapped).toBe(baseAdapter);
    });

    it("should return innermost adapter in single decorator", () => {
      const innermost = decorator.testGetInnerMost();
      expect(innermost).toBe(baseAdapter);
    });

    it("should navigate through decorator chain to find innermost", () => {
      const decorator1 = new TestDecorator(baseAdapter);
      const decorator2 = new TestDecorator(decorator1);
      const decorator3 = new TestDecorator(decorator2);

      expect(decorator3.testGetInnerMost()).toBe(baseAdapter);
    });

    it("should handle nested decorators correctly", () => {
      const loggingDecorator = new LoggingDecorator(baseAdapter);
      const testDecorator = new TestDecorator(loggingDecorator);

      expect(testDecorator.testGetWrapped()).toBe(loggingDecorator);
      expect(testDecorator.testGetInnerMost()).toBe(baseAdapter);
    });
  });

  describe("decorator composition", () => {
    it("should work with multiple decorators", async () => {
      const loggingDecorator = new LoggingDecorator(baseAdapter);
      const testDecorator = new TestDecorator(loggingDecorator);

      const request = createTestRequest();

      await testDecorator.saveToken(request);

      // Both decorators should have been involved
      expect(testDecorator.saveTokenCalled).toBe(true);
      expect(loggingDecorator.logs).toContain(`Saving token: ${request.token}`);
      expect(loggingDecorator.logs).toContain(`Saved token: ${request.token}`);

      // Data should be in base adapter
      const data = await baseAdapter.getTokenData(request.token);
      expect(data).toEqual(request.data);
    });

    it("should maintain decorator order in chain", async () => {
      const logging1 = new LoggingDecorator(baseAdapter);
      const logging2 = new LoggingDecorator(logging1);

      const request = createTestRequest();

      await logging2.saveToken(request);

      // Outer decorator logs should come first
      const logs = [...logging1.logs, ...logging2.logs];
      expect(logs.indexOf("Saving token: test-token-123")).toBeLessThan(
        logs.lastIndexOf("Saving token: test-token-123")
      );
    });
  });

  describe("error propagation", () => {
    it("should propagate errors from wrapped adapter", async () => {
      // Create a mock adapter that throws
      const errorAdapter: ITokenStoreAdapter = {
        saveToken: jest.fn().mockRejectedValue(new Error("Base adapter error")),
        getTokenData: jest
          .fn()
          .mockRejectedValue(new Error("Base adapter error")),
        deleteToken: jest
          .fn()
          .mockRejectedValue(new Error("Base adapter error")),
        isHealthy: jest.fn().mockRejectedValue(new Error("Base adapter error")),
      };

      const decorator = new TestDecorator(errorAdapter);

      await expect(decorator.saveToken(createTestRequest())).rejects.toThrow(
        "Base adapter error"
      );
      await expect(decorator.getTokenData("token")).rejects.toThrow(
        "Base adapter error"
      );
      await expect(decorator.deleteToken("token")).rejects.toThrow(
        "Base adapter error"
      );
      await expect(decorator.isHealthy()).rejects.toThrow("Base adapter error");
    });

    it("should handle errors in decorator chain", async () => {
      class ErrorDecorator extends StoreAdapterDecorator {
        async saveToken(request: TokenSaveRequest): Promise<void> {
          throw new Error("Decorator error");
        }
      }

      const errorDecorator = new ErrorDecorator(baseAdapter);
      const testDecorator = new TestDecorator(errorDecorator);

      await expect(
        testDecorator.saveToken(createTestRequest())
      ).rejects.toThrow("Decorator error");
    });
  });

  describe("real-world scenarios", () => {
    it("should work as a caching layer", async () => {
      class CachingDecorator extends StoreAdapterDecorator {
        private cache = new Map<string, TokenData>();

        async saveToken(request: TokenSaveRequest): Promise<void> {
          await super.saveToken(request);
          this.cache.set(request.token, request.data);
        }

        async getTokenData(token: string): Promise<TokenData | null> {
          if (this.cache.has(token)) {
            return this.cache.get(token) || null;
          }

          const data = await super.getTokenData(token);
          if (data) {
            this.cache.set(token, data);
          }
          return data;
        }

        async deleteToken(token: string): Promise<void> {
          await super.deleteToken(token);
          this.cache.delete(token);
        }
      }

      const cachingDecorator = new CachingDecorator(baseAdapter);
      const request = createTestRequest();

      // Save token
      await cachingDecorator.saveToken(request);

      // First get should hit base adapter and cache result
      const data1 = await cachingDecorator.getTokenData(request.token);
      expect(data1).toEqual(request.data);

      // Clear base adapter to test cache
      baseAdapter.clear();

      // Second get should hit cache
      const data2 = await cachingDecorator.getTokenData(request.token);
      expect(data2).toEqual(request.data);
    });
  });
});
