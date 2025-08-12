import {
  ITokenStoreAdapter,
  ITokenValidator,
  ITokenPlugin,
  TokenSaveRequest,
  TokenData,
  TokenRegistryConfig,
  DEFAULT_CONFIG,
  ITokenMeta,
} from "../../core/interfaces";

// ==================== TEST DATA FACTORIES ====================

export interface TestTokenMeta extends ITokenMeta {
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  [key: string]: unknown;
}

export const createTestTokenData = (
  overrides?: Partial<TokenData<TestTokenMeta>>
): TokenData<TestTokenMeta> => {
  const now = Date.now();
  return {
    sub: "test-user-123",
    issuedAt: now,
    expiresAt: now + 60000, // 1 minute from now
    meta: {
      deviceId: "test-device-456",
      ipAddress: "192.168.1.100",
      userAgent: "Test-Agent/1.0",
      sessionId: "test-session-789",
    },
    version: "1.0",
    ...overrides,
  };
};

export const createTestSaveRequest = (
  overrides?: Partial<TokenSaveRequest<TestTokenMeta>>
): TokenSaveRequest<TestTokenMeta> => ({
  token: "test-token-" + Math.random().toString(36).substr(2, 9),
  data: createTestTokenData(overrides?.data),
  ttl: 3600, // 1 hour
  ...overrides,
});

export const createTestConfig = (
  overrides?: Partial<TokenRegistryConfig>
): TokenRegistryConfig => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

// ==================== MOCK FACTORIES ====================

export const createMockStoreAdapter = (): jest.Mocked<ITokenStoreAdapter> => ({
  saveToken: jest.fn().mockResolvedValue(undefined),
  getTokenData: jest.fn().mockResolvedValue(null),
  deleteToken: jest.fn().mockResolvedValue(undefined),
  saveBatchTokens: jest.fn().mockResolvedValue(undefined),
  isHealthy: jest.fn().mockResolvedValue(true),
});

export const createMockValidator = <
  T extends ITokenMeta = ITokenMeta,
>(): jest.Mocked<ITokenValidator<T>> => ({
  validate: jest.fn().mockResolvedValue(undefined),
});

export const createMockPlugin = <T extends ITokenMeta = ITokenMeta>(
  name: string,
  priority: number = 100
): jest.Mocked<ITokenPlugin<T>> => ({
  name,
  priority,
  preSave: jest.fn().mockResolvedValue(undefined),
  postSave: jest.fn().mockResolvedValue(undefined),
  preGet: jest.fn().mockResolvedValue(undefined),
  postGet: jest.fn().mockResolvedValue(undefined),
  preRevoke: jest.fn().mockResolvedValue(undefined),
  postRevoke: jest.fn().mockResolvedValue(undefined),
  onError: jest.fn().mockResolvedValue(undefined),
});

// ==================== TEST UTILITIES ====================

export const waitFor = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const expectAsyncThrow = async (
  promiseFactory: () => Promise<any>,
  expectedError?: string | RegExp | jest.Constructable
): Promise<void> => {
  let error: Error | undefined;

  try {
    await promiseFactory();
  } catch (e) {
    error = e as Error;
  }

  expect(error).toBeDefined();

  if (expectedError) {
    if (typeof expectedError === "string") {
      expect(error!.message).toContain(expectedError);
    } else if (expectedError instanceof RegExp) {
      expect(error!.message).toMatch(expectedError);
    } else {
      expect(error).toBeInstanceOf(expectedError);
    }
  }
};

export const createTestTimeout = (timeoutMs: number) => {
  let timeoutId: NodeJS.Timeout;

  const promise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Test timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const clear = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };

  return { promise, clear };
};

// ==================== ASSERTION HELPERS ====================

export const expectTokenData = (
  actual: TokenData | null,
  expected: TokenData
): void => {
  expect(actual).not.toBeNull();
  expect(actual!.sub).toBe(expected.sub);
  expect(actual!.issuedAt).toBe(expected.issuedAt);
  expect(actual!.expiresAt).toBe(expected.expiresAt);
  expect(actual!.meta).toEqual(expected.meta);
  if (expected.version) {
    expect(actual!.version).toBe(expected.version);
  }
};

export const expectPluginCalled = (
  plugin: jest.Mocked<ITokenPlugin>,
  method: keyof ITokenPlugin,
  times: number = 1
): void => {
  const mockMethod = plugin[method] as jest.MockedFunction<any>;
  expect(mockMethod).toHaveBeenCalledTimes(times);
};

export const expectPluginNotCalled = (
  plugin: jest.Mocked<ITokenPlugin>,
  method: keyof ITokenPlugin
): void => {
  const mockMethod = plugin[method] as jest.MockedFunction<any>;
  expect(mockMethod).not.toHaveBeenCalled();
};

// ==================== PERFORMANCE TESTING ====================

export interface PerformanceTestResult {
  duration: number;
  opsPerSecond: number;
  averageMs: number;
}

export const runPerformanceTest = async (
  operation: () => Promise<void>,
  iterations: number = 1000
): Promise<PerformanceTestResult> => {
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    await operation();
  }

  const end = performance.now();
  const duration = end - start;
  const opsPerSecond = (iterations / duration) * 1000;
  const averageMs = duration / iterations;

  return {
    duration,
    opsPerSecond,
    averageMs,
  };
};

// ==================== CONCURRENCY TESTING ====================

export const runConcurrentTest = async (
  operation: () => Promise<void>,
  concurrency: number = 10,
  iterations: number = 100
): Promise<void> => {
  const promises: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    const promise = (async () => {
      for (let j = 0; j < iterations; j++) {
        await operation();
      }
    })();

    promises.push(promise);
  }

  await Promise.all(promises);
};

// ==================== MEMORY TESTING ====================

export const measureMemoryUsage = (): NodeJS.MemoryUsage => {
  if ((global as any).gc) {
    (global as any).gc();
  }
  return process.memoryUsage();
};

export const getMemoryDelta = (
  before: NodeJS.MemoryUsage,
  after: NodeJS.MemoryUsage
): Partial<NodeJS.MemoryUsage> => ({
  rss: after.rss - before.rss,
  heapTotal: after.heapTotal - before.heapTotal,
  heapUsed: after.heapUsed - before.heapUsed,
  external: after.external - before.external,
});

// ==================== STRESS TESTING ====================

export interface StressTestOptions {
  duration: number; // in milliseconds
  maxConcurrency: number;
  rampUpTime: number; // in milliseconds
}

export const runStressTest = async (
  operation: () => Promise<void>,
  options: StressTestOptions
): Promise<{
  totalOperations: number;
  errors: Error[];
  duration: number;
}> => {
  const { duration, maxConcurrency, rampUpTime } = options;
  const startTime = Date.now();
  const endTime = startTime + duration;

  let totalOperations = 0;
  const errors: Error[] = [];
  const workers: Promise<void>[] = [];

  // Ramp up workers gradually
  const rampUpInterval = rampUpTime / maxConcurrency;

  for (let i = 0; i < maxConcurrency; i++) {
    setTimeout(() => {
      const worker = (async () => {
        while (Date.now() < endTime) {
          try {
            await operation();
            totalOperations++;
          } catch (error) {
            errors.push(error as Error);
          }
        }
      })();

      workers.push(worker);
    }, i * rampUpInterval);
  }

  // Wait for all workers to complete
  await waitFor(duration + rampUpTime);
  await Promise.all(workers);

  return {
    totalOperations,
    errors,
    duration: Date.now() - startTime,
  };
};
