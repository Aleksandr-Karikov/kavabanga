import { BaseStoreAdapter } from "../../adapters/abstract.adapter";
import {
  TokenSaveRequest,
  TokenData,
  TokenOperationError,
} from "../../core/interfaces";

class TestStoreAdapter extends BaseStoreAdapter {
  private tokens = new Map<string, TokenData>();
  private shouldThrow = false;

  setShouldThrow(shouldThrow: boolean) {
    this.shouldThrow = shouldThrow;
  }

  async saveToken(request: TokenSaveRequest): Promise<void> {
    try {
      if (this.shouldThrow) {
        throw new Error("Test error");
      }
      this.tokens.set(request.token, request.data);
    } catch (error) {
      this.handleError("saveToken", error, { token: request.token });
    }
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    try {
      if (this.shouldThrow) {
        throw new Error("Test error");
      }
      return this.tokens.get(token) || null;
    } catch (error) {
      this.handleError("getTokenData", error, { token });
    }
  }

  async deleteToken(token: string): Promise<void> {
    try {
      if (this.shouldThrow) {
        throw new Error("Test error");
      }
      this.tokens.delete(token);
    } catch (error) {
      this.handleError("deleteToken", error, { token });
    }
  }

  async isHealthy(): Promise<boolean> {
    return !this.shouldThrow;
  }

  // Expose protected methods for testing
  public testValidateToken(token: string) {
    this.validateToken(token);
  }

  public testGetTokenKey(token: string) {
    return this.getTokenKey(token);
  }

  public testHandleError(operation: string, error: unknown, context?: any) {
    this.handleError(operation, error, context);
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

describe("BaseStoreAdapter", () => {
  let adapter: TestStoreAdapter;

  beforeEach(() => {
    adapter = new TestStoreAdapter();
  });

  describe("abstract methods implementation", () => {
    it("should implement saveToken", async () => {
      const request = createTestRequest();

      await adapter.saveToken(request);

      const data = await adapter.getTokenData(request.token);
      expect(data).toEqual(request.data);
    });

    it("should implement getTokenData", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      const data = await adapter.getTokenData(request.token);

      expect(data).toEqual(request.data);
    });

    it("should implement deleteToken", async () => {
      const request = createTestRequest();
      await adapter.saveToken(request);

      await adapter.deleteToken(request.token);

      const data = await adapter.getTokenData(request.token);
      expect(data).toBeNull();
    });

    it("should implement isHealthy", async () => {
      const health = await adapter.isHealthy();
      expect(typeof health).toBe("boolean");
    });
  });

  describe("saveBatchTokens default implementation", () => {
    it("should save tokens sequentially", async () => {
      const requests = [
        createTestRequest(),
        { ...createTestRequest(), token: "token2" },
        { ...createTestRequest(), token: "token3" },
      ];

      await adapter.saveBatchTokens(requests);

      for (const request of requests) {
        const data = await adapter.getTokenData(request.token);
        expect(data).toEqual(request.data);
      }
    });

    it("should handle empty batch", async () => {
      await expect(adapter.saveBatchTokens([])).resolves.not.toThrow();
    });

    it("should fail if any token fails", async () => {
      const requests = [
        createTestRequest(),
        { ...createTestRequest(), token: "token2" },
      ];

      // Make the adapter throw after first token
      await adapter.saveToken(requests[0]);
      adapter.setShouldThrow(true);

      await expect(adapter.saveBatchTokens(requests)).rejects.toThrow(
        TokenOperationError
      );
    });
  });

  describe("error handling", () => {
    it("should wrap errors in TokenOperationError", () => {
      const originalError = new Error("Original error");
      const context = { token: "test-token" };

      expect(() => {
        adapter.testHandleError("saveToken", originalError, context);
      }).toThrow(TokenOperationError);
    });

    it("should handle non-Error objects", () => {
      const errorValue = "string error";

      expect(() => {
        adapter.testHandleError("saveToken", errorValue);
      }).toThrow(TokenOperationError);
    });

    it("should include operation name in error message", () => {
      const originalError = new Error("Original error");

      try {
        adapter.testHandleError("testOperation", originalError);
      } catch (error) {
        expect(error).toBeInstanceOf(TokenOperationError);
        expect((error as TokenOperationError).message).toContain(
          "testOperation"
        );
        expect((error as TokenOperationError).message).toContain(
          "Original error"
        );
      }
    });

    it("should include context in wrapped error", () => {
      const originalError = new Error("Original error");
      const context = { token: "test-token", userId: "user123" };

      try {
        adapter.testHandleError("saveToken", originalError, context);
      } catch (error) {
        expect(error).toBeInstanceOf(TokenOperationError);
        expect((error as TokenOperationError).context).toEqual(
          expect.objectContaining(context)
        );
      }
    });
  });

  describe("token validation", () => {
    it("should accept valid token", () => {
      expect(() => {
        adapter.testValidateToken("valid-token-123");
      }).not.toThrow();
    });

    it("should reject empty token", () => {
      expect(() => {
        adapter.testValidateToken("");
      }).toThrow("Invalid token format");
    });

    it("should reject null token", () => {
      expect(() => {
        adapter.testValidateToken(null as any);
      }).toThrow("Invalid token format");
    });

    it("should reject undefined token", () => {
      expect(() => {
        adapter.testValidateToken(undefined as any);
      }).toThrow("Invalid token format");
    });

    it("should reject non-string token", () => {
      expect(() => {
        adapter.testValidateToken(123 as any);
      }).toThrow("Invalid token format");
    });
  });

  describe("token key generation", () => {
    it("should generate consistent key for same token", () => {
      const token = "test-token";
      const key1 = adapter.testGetTokenKey(token);
      const key2 = adapter.testGetTokenKey(token);

      expect(key1).toBe(key2);
      expect(key1).toBe(`token:${token}`);
    });

    it("should generate different keys for different tokens", () => {
      const token1 = "token1";
      const token2 = "token2";

      const key1 = adapter.testGetTokenKey(token1);
      const key2 = adapter.testGetTokenKey(token2);

      expect(key1).not.toBe(key2);
      expect(key1).toBe(`token:${token1}`);
      expect(key2).toBe(`token:${token2}`);
    });
  });

  describe("integration with error handling", () => {
    it("should handle errors in saveToken", async () => {
      adapter.setShouldThrow(true);

      await expect(adapter.saveToken(createTestRequest())).rejects.toThrow(
        TokenOperationError
      );
    });

    it("should handle errors in getTokenData", async () => {
      adapter.setShouldThrow(true);

      await expect(adapter.getTokenData("test-token")).rejects.toThrow(
        TokenOperationError
      );
    });

    it("should handle errors in deleteToken", async () => {
      adapter.setShouldThrow(true);

      await expect(adapter.deleteToken("test-token")).rejects.toThrow(
        TokenOperationError
      );
    });
  });
});
