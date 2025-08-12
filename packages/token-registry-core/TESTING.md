# Testing Guide

This document describes the testing setup and strategies for the Token Registry Core library.

## Test Structure

The test suite is organized into several categories:

```
src/__tests__/
├── setup.ts                    # Global test setup
├── utils/
│   └── test-helpers.ts         # Shared test utilities
├── core/                       # Unit tests for core components
│   ├── interfaces.test.ts      # Error classes and types
│   ├── validators.test.ts      # Validator implementations
│   └── service.test.ts         # Main service logic
├── adapters/                   # Unit tests for adapters
│   ├── abstract.adapter.test.ts
│   ├── decorator.adapter.test.ts
│   └── memory.adapter.test.ts
├── integration/                # Integration tests
│   ├── end-to-end.test.ts     # Complete workflows
│   └── performance.test.ts     # Performance benchmarks
├── module.test.ts              # NestJS module tests
└── index.test.ts               # Public API tests
```

## Running Tests

### All Tests

```bash
yarn test
```

### Unit Tests Only

```bash
yarn test:unit
```

### Integration Tests Only

```bash
yarn test:integration
```

### Performance Tests

```bash
yarn test:performance
```

### Watch Mode

```bash
yarn test:watch
```

### Coverage Report

```bash
yarn test:coverage
```

### CI Mode

```bash
yarn test:ci
```

## Test Categories

### Unit Tests

Unit tests focus on individual components in isolation:

- **Core Interfaces & Types**: Test error classes, type validation, and configuration
- **Validators**: Test all validation logic including edge cases
- **Service**: Test the main TokenRegistryService with mocked dependencies
- **Adapters**: Test adapter implementations and the decorator pattern

### Integration Tests

Integration tests verify complete workflows:

- **End-to-End**: Full token lifecycle with real components
- **NestJS Module**: Module registration and dependency injection
- **Error Handling**: Error propagation through the system
- **Plugin System**: Plugin execution and error handling

### Performance Tests

Performance tests ensure the library meets performance requirements:

- **Single Operations**: Individual operation benchmarks
- **Batch Operations**: Bulk operation efficiency
- **Concurrent Operations**: Thread safety and performance under load
- **Memory Usage**: Memory efficiency and leak detection

## Test Utilities

The test suite includes comprehensive utilities in `test-helpers.ts`:

### Data Factories

- `createTestTokenData()`: Generate test token data
- `createTestSaveRequest()`: Generate test save requests
- `createTestConfig()`: Generate test configurations

### Mock Factories

- `createMockStoreAdapter()`: Mock storage adapter
- `createMockValidator()`: Mock validator
- `createMockPlugin()`: Mock plugin

### Performance Testing

- `runPerformanceTest()`: Benchmark operation performance
- `runConcurrentTest()`: Test concurrent operations
- `measureMemoryUsage()`: Memory usage measurement

### Assertions

- `expectTokenData()`: Assert token data equality
- `expectPluginCalled()`: Assert plugin method calls
- `expectAsyncThrow()`: Assert async exceptions

## Writing Tests

### Unit Test Example

```typescript
import { DefaultTokenValidator } from "../validators";
import { createTestSaveRequest } from "../utils/test-helpers";

describe("DefaultTokenValidator", () => {
  let validator: DefaultTokenValidator;

  beforeEach(() => {
    validator = new DefaultTokenValidator(mockConfig);
  });

  it("should validate valid token", async () => {
    const request = createTestSaveRequest();
    await expect(validator.validate(request)).resolves.not.toThrow();
  });
});
```

### Integration Test Example

```typescript
import { Test } from "@nestjs/testing";
import { TokenRegistryModule, TokenRegistryService } from "../index";

describe("Token Lifecycle", () => {
  let service: TokenRegistryService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        TokenRegistryModule.forRoot({
          /* config */
        }),
      ],
    }).compile();

    service = module.get<TokenRegistryService>(TokenRegistryService);
  });

  it("should complete full lifecycle", async () => {
    // Save, retrieve, revoke token
  });
});
```

### Performance Test Example

```typescript
import { runPerformanceTest } from "../utils/test-helpers";

it("should save tokens efficiently", async () => {
  const result = await runPerformanceTest(async () => {
    await service.saveToken(token, data, ttl);
  }, 1000);

  expect(result.opsPerSecond).toBeGreaterThan(1000);
});
```

## Coverage Goals

The test suite aims for high coverage:

- **Statements**: > 95%
- **Branches**: > 90%
- **Functions**: > 95%
- **Lines**: > 95%

## Performance Benchmarks

Expected performance characteristics:

- **Token Save**: > 1,000 ops/sec
- **Token Retrieve**: > 5,000 ops/sec
- **Memory Usage**: < 10KB per token
- **Concurrent Operations**: No deadlocks or race conditions

## Continuous Integration

The CI pipeline runs:

1. Type checking (`yarn check-types`)
2. Linting (`yarn lint`)
3. Unit tests (`yarn test:unit`)
4. Integration tests (`yarn test:integration`)
5. Coverage report (`yarn test:coverage`)

Performance tests run separately as they require more resources.

## Debugging Tests

### Common Issues

1. **Timer-based tests**: Use `jest.useFakeTimers()` for predictable timing
2. **Memory leaks**: Clear adapters in `afterEach()` hooks
3. **Plugin errors**: Mock `console.error` to reduce noise

### Debug Commands

```bash
# Run specific test file
yarn test src/__tests__/core/service.test.ts

# Run tests matching pattern
yarn test --testNamePattern="should save token"

# Run tests in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Clear naming**: Test names should describe the expected behavior
3. **Mock external dependencies**: Use mocks for adapters, validators, etc.
4. **Test edge cases**: Include error conditions and boundary values
5. **Performance awareness**: Consider the impact of test data on performance tests
6. **Cleanup**: Always clean up resources in teardown hooks
