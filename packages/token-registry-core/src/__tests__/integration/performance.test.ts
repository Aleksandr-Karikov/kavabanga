import { TokenRegistryService } from "../../core/service";
import { InMemoryStoreAdapter } from "../../adapters/memory.adapter";
import { NoOpValidator, DefaultTokenValidator } from "../../core/validators";
import { DEFAULT_CONFIG } from "../../core/interfaces";
import {
  createTestSaveRequest,
  runPerformanceTest,
  runConcurrentTest,
  measureMemoryUsage,
  getMemoryDelta,
} from "../utils/test-helpers";

describe("Performance Tests", () => {
  let service: TokenRegistryService;
  let adapter: InMemoryStoreAdapter;

  beforeEach(() => {
    adapter = new InMemoryStoreAdapter();
    service = new TokenRegistryService(
      adapter,
      { ...DEFAULT_CONFIG, operationTimeout: 0 }, // No timeout for performance tests
      new NoOpValidator()
    );
  });

  afterEach(() => {
    adapter.clear();
  });

  describe("Single Operations Performance", () => {
    it("should save tokens efficiently", async () => {
      const result = await runPerformanceTest(async () => {
        const request = createTestSaveRequest();
        await service.saveToken(request.token, request.data, request.ttl);
      }, 1000);

      expect(result.opsPerSecond).toBeGreaterThan(1000); // At least 1000 ops/sec
      expect(result.averageMs).toBeLessThan(1); // Less than 1ms per operation
    });

    it("should retrieve tokens efficiently", async () => {
      // Pre-populate with tokens
      const tokens: string[] = [];
      for (let i = 0; i < 1000; i++) {
        const request = createTestSaveRequest();
        await service.saveToken(request.token, request.data, request.ttl);
        tokens.push(request.token);
      }

      const result = await runPerformanceTest(async () => {
        const randomToken = tokens[Math.floor(Math.random() * tokens.length)]!;
        await service.getTokenData(randomToken);
      }, 1000);

      expect(result.opsPerSecond).toBeGreaterThan(5000); // At least 5000 ops/sec
      expect(result.averageMs).toBeLessThan(0.2); // Less than 0.2ms per operation
    });

    it("should delete tokens efficiently", async () => {
      // Pre-populate with tokens
      const tokens: string[] = [];
      for (let i = 0; i < 1000; i++) {
        const request = createTestSaveRequest();
        await service.saveToken(request.token, request.data, request.ttl);
        tokens.push(request.token);
      }

      let tokenIndex = 0;
      const result = await runPerformanceTest(async () => {
        if (tokenIndex < tokens.length) {
          await service.revokeToken(tokens[tokenIndex++]!);
        }
      }, 1000);

      expect(result.opsPerSecond).toBeGreaterThan(1000); // At least 1000 ops/sec
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle concurrent saves", async () => {
      const startTime = Date.now();

      await runConcurrentTest(
        async () => {
          const request = createTestSaveRequest();
          await service.saveToken(request.token, request.data, request.ttl);
        },
        10,
        100
      ); // 10 concurrent workers, 100 operations each

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // Should complete in less than 5 seconds
      expect(adapter.getActiveTokenCount()).toBe(1000); // All tokens should be saved
    });

    it("should handle concurrent reads", async () => {
      // Pre-populate
      const tokens: string[] = [];
      for (let i = 0; i < 100; i++) {
        const request = createTestSaveRequest();
        await service.saveToken(request.token, request.data, request.ttl);
        tokens.push(request.token);
      }

      const startTime = Date.now();

      await runConcurrentTest(
        async () => {
          const randomToken =
            tokens[Math.floor(Math.random() * tokens.length)]!;
          const data = await service.getTokenData(randomToken);
          expect(data).not.toBeNull();
        },
        20,
        50
      ); // 20 concurrent workers, 50 operations each

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2000); // Should complete in less than 2 seconds
    });

    it("should handle mixed concurrent operations", async () => {
      const operations = [
        // Save operation
        async () => {
          const request = createTestSaveRequest();
          await service.saveToken(request.token, request.data, request.ttl);
        },
        // Read operation
        async () => {
          const tokenCount = adapter.getActiveTokenCount();
          if (tokenCount > 0) {
            const tokens = adapter.getActiveTokens();
            const randomToken =
              tokens[Math.floor(Math.random() * tokens.length)]!;
            await service.getTokenData(randomToken);
          }
        },
        // Delete operation
        async () => {
          const tokenCount = adapter.getActiveTokenCount();
          if (tokenCount > 0) {
            const tokens = adapter.getActiveTokens();
            const randomToken =
              tokens[Math.floor(Math.random() * tokens.length)]!;
            try {
              await service.revokeToken(randomToken);
            } catch {
              // Token might have been deleted by another operation
            }
          }
        },
      ];

      await runConcurrentTest(
        async () => {
          const randomOperation =
            operations[Math.floor(Math.random() * operations.length)]!;
          await randomOperation();
        },
        15,
        50
      ); // 15 concurrent workers, 50 operations each

      // Should not crash or deadlock
      expect(adapter.getActiveTokenCount()).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Memory Usage", () => {
    it("should have reasonable memory usage for large token counts", async () => {
      const beforeMemory = measureMemoryUsage();

      // Save 10,000 tokens
      for (let i = 0; i < 10000; i++) {
        const request = createTestSaveRequest();
        await service.saveToken(request.token, request.data, request.ttl);
      }

      const afterMemory = measureMemoryUsage();
      const delta = getMemoryDelta(beforeMemory, afterMemory);

      // Should not use more than 100MB for 10,000 tokens
      expect(delta.heapUsed!).toBeLessThan(100 * 1024 * 1024);

      // Memory usage should be reasonable per token (less than 10KB per token)
      const memoryPerToken = delta.heapUsed! / 10000;
      expect(memoryPerToken).toBeLessThan(10 * 1024);
    });

    it("should clean up memory when tokens are deleted", async () => {
      // Save tokens
      const tokens: string[] = [];
      for (let i = 0; i < 1000; i++) {
        const request = createTestSaveRequest();
        await service.saveToken(request.token, request.data, request.ttl);
        tokens.push(request.token);
      }

      const beforeCleanup = measureMemoryUsage();

      // Delete all tokens
      for (const token of tokens) {
        await service.revokeToken(token);
      }

      // Force garbage collection if available
      if ((global as any).gc) {
        (global as any).gc();
      }

      const afterCleanup = measureMemoryUsage();
      const delta = getMemoryDelta(beforeCleanup, afterCleanup);

      // Memory should not significantly increase (allow for some noise)
      expect(delta.heapUsed!).toBeLessThan(10 * 1024 * 1024); // Less than 10MB increase
    });
  });

  describe("Validation Performance Impact", () => {
    it("should compare performance with and without validation", async () => {
      // Test with validation
      const serviceWithValidation = new TokenRegistryService(
        new InMemoryStoreAdapter(),
        { ...DEFAULT_CONFIG, operationTimeout: 0 },
        new DefaultTokenValidator(DEFAULT_CONFIG)
      );

      const withValidationResult = await runPerformanceTest(async () => {
        const request = createTestSaveRequest();
        await serviceWithValidation.saveToken(
          request.token,
          request.data,
          request.ttl
        );
      }, 500);

      // Test without validation
      const withoutValidationResult = await runPerformanceTest(async () => {
        const request = createTestSaveRequest();
        await service.saveToken(request.token, request.data, request.ttl);
      }, 500);

      // Validation should not slow down operations by more than 10x (allow for CI variance)
      const slowdownRatio =
        withValidationResult.averageMs / withoutValidationResult.averageMs;
      expect(slowdownRatio).toBeLessThan(10);

      (serviceWithValidation.getStoreAdapter() as any).clear?.();
    });
  });

  describe("Plugin Performance Impact", () => {
    it("should measure plugin overhead", async () => {
      const plugin = {
        name: "TestPlugin",
        priority: 100,
        preSave: jest.fn().mockResolvedValue(undefined),
        postSave: jest.fn().mockResolvedValue(undefined),
      };

      service.registerPlugin(plugin);

      const result = await runPerformanceTest(async () => {
        const request = createTestSaveRequest();
        await service.saveToken(request.token, request.data, request.ttl);
      }, 500);

      // Plugin overhead should be minimal
      expect(result.opsPerSecond).toBeGreaterThan(500); // At least 500 ops/sec with plugin
      expect(plugin.preSave).toHaveBeenCalledTimes(500);
      expect(plugin.postSave).toHaveBeenCalledTimes(500);
    });
  });
});
