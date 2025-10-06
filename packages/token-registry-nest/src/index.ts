// ===================== MODULE EXPORTS =====================

export { TokenRegistryModule } from "./token-registry.module";

// ===================== INTERFACES =====================

export type {
  TokenRegistryModuleOptions,
  TokenRegistryModuleAsyncOptions,
} from "./interfaces";

// ===================== DECORATORS =====================

export { InjectTokenRegistry } from "./decorators";

// ===================== CONSTANTS =====================

export {
  TOKEN_REGISTRY_MODULE_OPTIONS,
  TOKEN_REGISTRY_SERVICE,
  TOKEN_REGISTRY_REDIS,
} from "./constants";

// ===================== RE-EXPORTS FROM CORE =====================

export type {
  ITokenStore,
  ITokenValidator,
  TokenEventHandler,
  TokenData,
  TokenRegistryConfig,
  ITokenMeta,
  TokenRegistryError,
  TokenValidationError,
  TokenNotFoundError,
  TokenOperationError,
  TokenTimeoutError,
} from "@kavabanga/token-registry-core";

export {
  TokenRegistryService,
  TokenRegistryServiceFactory,
  DefaultTokenValidator,
  NoOpValidator,
  DEFAULT_CONFIG,
  createMemoryStore,
  InMemoryStore,
} from "@kavabanga/token-registry-core";
