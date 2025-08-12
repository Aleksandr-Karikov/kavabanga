import {
  TokenRegistryError,
  TokenValidationError,
  TokenNotFoundError,
  TokenOperationError,
  TokenConfigurationError,
  TokenTimeoutError,
  DEFAULT_CONFIG,
} from "../../core/interfaces";

describe("TokenRegistryError", () => {
  it("should create error with message and context", () => {
    class TestError extends TokenRegistryError {
      readonly code = "TEST_ERROR";
    }

    const context = { test: "value" };
    const error = new TestError("Test message", context);

    expect(error.message).toBe("Test message");
    expect(error.context).toEqual(context);
    expect(error.code).toBe("TEST_ERROR");
    expect(error.name).toBe("TestError");
  });

  it("should serialize to JSON correctly", () => {
    class TestError extends TokenRegistryError {
      readonly code = "TEST_ERROR";
    }

    const error = new TestError("Test message", { key: "value" });
    const json = error.toJSON();

    expect(json).toEqual({
      name: "TestError",
      code: "TEST_ERROR",
      message: "Test message",
      context: { key: "value" },
      stack: expect.any(String),
    });
  });

  it("should work with instanceof checks", () => {
    const error = new TokenValidationError("Test");

    expect(error instanceof TokenRegistryError).toBe(true);
    expect(error instanceof TokenValidationError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });
});

describe("TokenValidationError", () => {
  it("should create validation error with correct message", () => {
    const error = new TokenValidationError("Invalid token");

    expect(error.message).toBe("Validation failed: Invalid token");
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("should include context if provided", () => {
    const context = { field: "token", value: "invalid" };
    const error = new TokenValidationError("Invalid token", context);

    expect(error.context).toEqual(context);
  });
});

describe("TokenNotFoundError", () => {
  it("should create error with token context", () => {
    const error = new TokenNotFoundError("test-token");

    expect(error.message).toBe("Token not found");
    expect(error.code).toBe("TOKEN_NOT_FOUND");
    expect(error.context).toEqual({ token: "test-token" });
  });

  it("should work without token parameter", () => {
    const error = new TokenNotFoundError();

    expect(error.message).toBe("Token not found");
    expect(error.context).toEqual({ token: undefined });
  });
});

describe("TokenOperationError", () => {
  it("should wrap original error with operation context", () => {
    const originalError = new Error("Original error");
    const error = new TokenOperationError("saveToken", originalError);

    expect(error.message).toBe("Operation 'saveToken' failed: Original error");
    expect(error.code).toBe("OPERATION_FAILED");
    expect(error.context).toEqual({
      originalError: "Original error",
      originalStack: originalError.stack,
    });
  });

  it("should include additional context", () => {
    const originalError = new Error("Original error");
    const additionalContext = { token: "test-token" };
    const error = new TokenOperationError(
      "saveToken",
      originalError,
      additionalContext
    );

    expect(error.context).toEqual({
      ...additionalContext,
      originalError: "Original error",
      originalStack: originalError.stack,
    });
  });
});

describe("TokenConfigurationError", () => {
  it("should create configuration error", () => {
    const error = new TokenConfigurationError("Invalid config");

    expect(error.message).toBe("Configuration error: Invalid config");
    expect(error.code).toBe("CONFIGURATION_ERROR");
  });
});

describe("TokenTimeoutError", () => {
  it("should create timeout error with operation details", () => {
    const error = new TokenTimeoutError("saveToken", 5000);

    expect(error.message).toBe("Operation 'saveToken' timed out after 5000ms");
    expect(error.code).toBe("TIMEOUT_ERROR");
    expect(error.context).toEqual({
      operation: "saveToken",
      timeout: 5000,
    });
  });
});

describe("DEFAULT_CONFIG", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_CONFIG).toEqual({
      enableValidation: true,
      defaultTtl: 30 * 24 * 60 * 60, // 30 days in seconds
      enablePlugins: true,
      strictMode: false,
      operationTimeout: 5000, // 5 seconds
    });
  });

  it("should be immutable", () => {
    const original = { ...DEFAULT_CONFIG };

    // Try to modify the config (should throw in strict mode or fail silently)
    expect(() => {
      (DEFAULT_CONFIG as any).enableValidation = false;
    }).toThrow();

    // The actual DEFAULT_CONFIG should remain unchanged
    expect(DEFAULT_CONFIG).toEqual(original);
  });
});
