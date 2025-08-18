// Test setup file
import "jest";

// Global test setup
beforeEach(() => {
  jest.clearAllMocks();

  // Reset any global state if needed
  if ((global as any).gc) {
    (global as any).gc();
  }
});

afterEach(() => {
  // Clean up any global state
  jest.clearAllTimers();
  jest.restoreAllMocks();
});

// Setup global test timeout
jest.setTimeout(10000);

// Mock console methods in tests to reduce noise
global.console = {
  ...console,
  // Uncomment to ignore specific console methods during tests
  // log: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Global error handler for unhandled promise rejections in tests
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Fail the test if there's an unhandled rejection
  process.exit(1);
});

// Performance testing globals
declare global {
  namespace NodeJS {
    interface Global {
      gc?: () => void;
    }
  }
}
