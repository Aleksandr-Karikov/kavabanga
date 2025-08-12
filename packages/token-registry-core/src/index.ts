// ===================== CORE INTERFACES & TYPES =====================

// Core interfaces and types - the foundation of the token registry
export * from "./core/interfaces";
export * from "./core/validators";

// ===================== CORE SERVICE =====================

// Main service implementation
export {
  TokenRegistryService,
  TokenRegistryServiceFactory,
} from "./core/service";

// ===================== BASE ADAPTERS =====================

// Abstract base classes for implementing custom adapters
export * from "./adapters/abstract.adapter";
export * from "./adapters/decorator.adapter";

// ===================== BUILT-IN ADAPTERS =====================

// In-memory adapter for development and testing
export * from "./adapters/memory.adapter";

// ===================== NESTJS MODULE =====================

// NestJS integration
export * from "./module";

// ===================== TYPE EXPORTS =====================

// Export commonly used types for TypeScript users
export type {
  ITokenStoreAdapter,
  ITokenPlugin,
  ITokenMeta,
  TokenSaveRequest,
  TokenData,
  PluginExecutionContext,
  PluginHook,
  TokenOperationError,
  TokenValidationError,
  TokenRegistryError,
} from "./core/interfaces";

// ===================== FACTORY FUNCTIONS =====================

// Re-export factory functions from memory adapter
export {
  createDevelopmentMemoryAdapter,
  createTestMemoryAdapter,
} from "./adapters/memory.adapter";
