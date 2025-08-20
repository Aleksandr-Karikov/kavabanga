import { DynamicModule, Module, Provider } from "@nestjs/common";
import {
  TokenRegistryConfig,
  DEFAULT_CONFIG,
  TokenRegistryServiceFactory,
  DefaultTokenValidator,
  createMemoryStore,
} from "@kavabanga/token-registry-core";
import {
  TokenRegistryModuleOptions,
  TokenRegistryModuleAsyncOptions,
} from "./interfaces";
import {
  TOKEN_REGISTRY_MODULE_OPTIONS,
  TOKEN_REGISTRY_SERVICE,
} from "./constants";

@Module({})
export class TokenRegistryModule {
  /**
   * Register module with static options
   */
  static forRoot(options: TokenRegistryModuleOptions = {}): DynamicModule {
    return {
      module: TokenRegistryModule,
      global: options.global,
      providers: [...this.createProviders(options)],
      exports: [TOKEN_REGISTRY_SERVICE],
    };
  }

  /**
   * Register module with async options
   */
  static forRootAsync(options: TokenRegistryModuleAsyncOptions): DynamicModule {
    return {
      module: TokenRegistryModule,
      global: options.global,
      providers: [...this.createAsyncProviders(options)],
      exports: [TOKEN_REGISTRY_SERVICE],
    };
  }

  private static createProviders(
    options: TokenRegistryModuleOptions
  ): Provider[] {
    const config: TokenRegistryConfig = {
      ...DEFAULT_CONFIG,
      ...options.config,
    };

    return [
      {
        provide: TOKEN_REGISTRY_MODULE_OPTIONS,
        useValue: {
          config,
          storeFactory: options.storeFactory,
        },
      },
      {
        provide: TOKEN_REGISTRY_SERVICE,
        useFactory: async (moduleOptions: any) => {
          const store = moduleOptions.storeFactory
            ? await moduleOptions.storeFactory()
            : createMemoryStore();

          const validator = new DefaultTokenValidator(moduleOptions.config);
          return TokenRegistryServiceFactory.createDefault(store, validator);
        },
        inject: [TOKEN_REGISTRY_MODULE_OPTIONS],
      },
    ];
  }

  private static createAsyncProviders(
    options: TokenRegistryModuleAsyncOptions
  ): Provider[] {
    return [
      {
        provide: TOKEN_REGISTRY_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      },
      {
        provide: TOKEN_REGISTRY_SERVICE,
        useFactory: async (moduleOptions: any) => {
          const config: TokenRegistryConfig = {
            ...DEFAULT_CONFIG,
            ...moduleOptions.config,
          };

          const store = moduleOptions.storeFactory
            ? await moduleOptions.storeFactory()
            : createMemoryStore();

          const validator = new DefaultTokenValidator(config);
          return TokenRegistryServiceFactory.createDefault(store, validator);
        },
        inject: [TOKEN_REGISTRY_MODULE_OPTIONS],
      },
    ];
  }
}
