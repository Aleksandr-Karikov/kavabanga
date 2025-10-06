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
    const finalConfig: TokenRegistryConfig = {
      ...DEFAULT_CONFIG,
      ...(options.config || {}),
    };

    return [
      {
        provide: TOKEN_REGISTRY_MODULE_OPTIONS,
        useValue: {
          config: finalConfig,
          storeFactory: options.storeFactory,
          eventHandlers: options.eventHandlers || [],
        },
      },
      {
        provide: TOKEN_REGISTRY_SERVICE,
        useFactory: async (moduleOptions: TokenRegistryModuleOptions) => {
          const store = moduleOptions.storeFactory
            ? await moduleOptions.storeFactory()
            : createMemoryStore();

          const finalConfig: TokenRegistryConfig = {
            ...DEFAULT_CONFIG,
            ...(moduleOptions.config || {}),
          };

          const validator = new DefaultTokenValidator(finalConfig);

          return TokenRegistryServiceFactory.create(
            store,
            finalConfig,
            validator,
            moduleOptions.eventHandlers ?? []
          );
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
        useFactory: async (moduleOptions: TokenRegistryModuleOptions) => {
          const finalConfig: TokenRegistryConfig = {
            ...DEFAULT_CONFIG,
            ...(moduleOptions.config || {}),
          };

          const store = moduleOptions.storeFactory
            ? await moduleOptions.storeFactory()
            : createMemoryStore();

          const validator = new DefaultTokenValidator(finalConfig);

          return TokenRegistryServiceFactory.create(
            store,
            finalConfig,
            validator,
            moduleOptions.eventHandlers ?? []
          );
        },
        inject: [TOKEN_REGISTRY_MODULE_OPTIONS],
      },
    ];
  }
}
