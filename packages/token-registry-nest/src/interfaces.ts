import {
  TokenRegistryConfig,
  ITokenMeta,
  ITokenStore,
  TokenEventHandler,
} from "@kavabanga/token-registry-core";

export interface TokenRegistryModuleOptions {
  /**
   * Token registry configuration
   */
  config?: Partial<TokenRegistryConfig>;

  /**
   * Store factory function
   */
  storeFactory?: () => ITokenStore | Promise<ITokenStore>;

  /**
   * Global module flag
   */
  global?: boolean;

  /**
   * event handlers
   */
  eventHandlers?: TokenEventHandler[];
}

export interface TokenRegistryModuleAsyncOptions {
  /**
   * Global module flag
   */
  global?: boolean;

  /**
   * Factory function to create options
   */
  useFactory: (
    ...args: any[]
  ) => Promise<TokenRegistryModuleOptions> | TokenRegistryModuleOptions;

  /**
   * Dependencies to inject
   */
  inject?: any[];
}
