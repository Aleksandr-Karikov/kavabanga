import {
  DynamicModule,
  Module,
  Provider,
  Type,
  FactoryProvider,
  ValueProvider,
  ClassProvider,
} from "@nestjs/common";

import {
  ITokenStoreAdapter,
  ITokenPlugin,
  ITokenValidator,
  ITokenMeta,
  TokenRegistryConfig,
  DEFAULT_CONFIG,
  TokenConfigurationError,
} from "./core/interfaces";

import { TokenRegistryService } from "./core/service";
import { DefaultTokenValidator, NoOpValidator } from "./core/validators";

// ===================== MODULE OPTIONS =====================

export interface TokenRegistryModuleOptions<T extends ITokenMeta = ITokenMeta> {
  /**
   * Store adapter для сохранения токенов
   */
  storeAdapter: ITokenStoreAdapter | Type<ITokenStoreAdapter>;

  /**
   * Конфигурация модуля (опционально)
   */
  config?: Partial<TokenRegistryConfig>;

  /**
   * Валидатор токенов (опционально, по умолчанию DefaultTokenValidator)
   */
  validator?:
    | ITokenValidator<T>
    | Type<ITokenValidator<T>>
    | "default"
    | "none";

  /**
   * Плагины для расширения функциональности
   */
  plugins?: Array<ITokenPlugin<T> | Type<ITokenPlugin<T>>>;

  /**
   * Делать ли модуль глобальным
   */
  isGlobal?: boolean;

  /**
   * Дополнительные провайдеры
   */
  extraProviders?: Provider[];

  /**
   * Дополнительные экспорты
   */
  extraExports?: (string | symbol | Type<any>)[];
}

export interface TokenRegistryAsyncOptions<T extends ITokenMeta = ITokenMeta> {
  /**
   * Импорты других модулей
   */
  imports?: any[];

  /**
   * Factory function для создания опций модуля
   */
  useFactory?: (
    ...args: any[]
  ) => Promise<TokenRegistryModuleOptions<T>> | TokenRegistryModuleOptions<T>;

  /**
   * Зависимости для factory function
   */
  inject?: any[];

  /**
   * Использовать существующий класс как опции
   */
  useClass?: Type<TokenRegistryModuleOptions<T>>;

  /**
   * Использовать существующий провайдер как опции
   */
  useExisting?: string | symbol | Type<TokenRegistryModuleOptions<T>>;

  /**
   * Делать ли модуль глобальным
   */
  isGlobal?: boolean;

  /**
   * Дополнительные провайдеры
   */
  extraProviders?: Provider[];

  /**
   * Дополнительные экспорты
   */
  extraExports?: (string | symbol | Type<any>)[];
}

// ===================== TOKENS =====================

export const TOKEN_REGISTRY_OPTIONS = Symbol("TOKEN_REGISTRY_OPTIONS");
export const TOKEN_REGISTRY_CONFIG = Symbol("TOKEN_REGISTRY_CONFIG");
export const TOKEN_STORE_ADAPTER = Symbol("TOKEN_STORE_ADAPTER");
export const TOKEN_VALIDATOR = Symbol("TOKEN_VALIDATOR");
export const TOKEN_PLUGINS = Symbol("TOKEN_PLUGINS");

// ===================== MAIN MODULE =====================

@Module({})
export class TokenRegistryModule {
  /**
   * Синхронная регистрация модуля
   */
  static forRoot<T extends ITokenMeta = ITokenMeta>(
    options: TokenRegistryModuleOptions<T>
  ): DynamicModule {
    // Валидируем опции
    this.validateOptions(options);

    const providers = this.createProviders(options);
    const exports = this.createExports(options);

    return {
      module: TokenRegistryModule,
      providers,
      exports,
      global: options.isGlobal ?? false,
    };
  }

  /**
   * Асинхронная регистрация модуля
   */
  static forRootAsync<T extends ITokenMeta = ITokenMeta>(
    options: TokenRegistryAsyncOptions<T>
  ): DynamicModule {
    const providers = this.createAsyncProviders(options);
    const exports = this.createAsyncExports(options);

    return {
      module: TokenRegistryModule,
      imports: options.imports || [],
      providers,
      exports,
      global: options.isGlobal ?? false,
    };
  }

  // ===================== PROVIDER CREATION =====================

  private static createProviders<T extends ITokenMeta = ITokenMeta>(
    options: TokenRegistryModuleOptions<T>
  ): Provider[] {
    const providers: Provider[] = [];

    // Конфигурация
    providers.push(this.createConfigProvider(options.config));

    // Store Adapter
    providers.push(this.createStoreAdapterProvider(options.storeAdapter));

    // Validator
    providers.push(this.createValidatorProvider(options.validator));

    // Plugins
    if (options.plugins && options.plugins.length > 0) {
      providers.push(this.createPluginsProvider(options.plugins));
    }

    // Main Service
    providers.push(this.createServiceProvider());

    // Extra providers
    if (options.extraProviders) {
      providers.push(...options.extraProviders);
    }

    return providers;
  }

  private static createAsyncProviders<T extends ITokenMeta = ITokenMeta>(
    options: TokenRegistryAsyncOptions<T>
  ): Provider[] {
    const providers: Provider[] = [];

    // Options provider
    providers.push(this.createAsyncOptionsProvider(options));

    // Конфигурация
    providers.push(this.createAsyncConfigProvider());

    // Store Adapter
    providers.push(this.createAsyncStoreAdapterProvider());

    // Validator
    providers.push(this.createAsyncValidatorProvider());

    // Plugins
    providers.push(this.createAsyncPluginsProvider());

    // Main Service
    providers.push(this.createAsyncServiceProvider());

    // Extra providers
    if (options.extraProviders) {
      providers.push(...options.extraProviders);
    }

    return providers;
  }

  // ===================== INDIVIDUAL PROVIDER CREATORS =====================

  private static createConfigProvider(
    configOptions?: Partial<TokenRegistryConfig>
  ): ValueProvider {
    return {
      provide: TOKEN_REGISTRY_CONFIG,
      useValue: {
        ...DEFAULT_CONFIG,
        ...configOptions,
      },
    };
  }

  private static createAsyncConfigProvider(): FactoryProvider {
    return {
      provide: TOKEN_REGISTRY_CONFIG,
      useFactory: (options: TokenRegistryModuleOptions) => ({
        ...DEFAULT_CONFIG,
        ...options.config,
      }),
      inject: [TOKEN_REGISTRY_OPTIONS],
    };
  }

  private static createStoreAdapterProvider(
    storeAdapter: ITokenStoreAdapter | Type<ITokenStoreAdapter>
  ): Provider {
    if (typeof storeAdapter === "function") {
      return {
        provide: TOKEN_STORE_ADAPTER,
        useClass: storeAdapter,
      } as ClassProvider;
    }

    return {
      provide: TOKEN_STORE_ADAPTER,
      useValue: storeAdapter,
    } as ValueProvider;
  }

  private static createAsyncStoreAdapterProvider(): FactoryProvider {
    return {
      provide: TOKEN_STORE_ADAPTER,
      useFactory: (options: TokenRegistryModuleOptions) => {
        if (typeof options.storeAdapter === "function") {
          return new options.storeAdapter();
        }
        return options.storeAdapter;
      },
      inject: [TOKEN_REGISTRY_OPTIONS],
    };
  }

  private static createValidatorProvider(
    validator?: ITokenValidator | Type<ITokenValidator> | "default" | "none"
  ): FactoryProvider {
    return {
      provide: TOKEN_VALIDATOR,
      useFactory: (config: TokenRegistryConfig) => {
        if (!validator || validator === "default") {
          return new DefaultTokenValidator(config);
        }

        if (validator === "none") {
          return new NoOpValidator();
        }

        if (typeof validator === "function") {
          return new validator(config);
        }

        return validator;
      },
      inject: [TOKEN_REGISTRY_CONFIG],
    };
  }

  private static createAsyncValidatorProvider(): FactoryProvider {
    return {
      provide: TOKEN_VALIDATOR,
      useFactory: (
        options: TokenRegistryModuleOptions,
        config: TokenRegistryConfig
      ) => {
        const validator = options.validator;

        if (!validator || validator === "default") {
          return new DefaultTokenValidator(config);
        }

        if (validator === "none") {
          return new NoOpValidator();
        }

        if (typeof validator === "function") {
          return new validator(config);
        }

        return validator;
      },
      inject: [TOKEN_REGISTRY_OPTIONS, TOKEN_REGISTRY_CONFIG],
    };
  }

  private static createPluginsProvider(
    plugins: Array<ITokenPlugin | Type<ITokenPlugin>>
  ): FactoryProvider {
    return {
      provide: TOKEN_PLUGINS,
      useFactory: () => {
        return plugins.map((plugin) => {
          if (typeof plugin === "function") {
            return new plugin();
          }
          return plugin;
        });
      },
    };
  }

  private static createAsyncPluginsProvider(): FactoryProvider {
    return {
      provide: TOKEN_PLUGINS,
      useFactory: (options: TokenRegistryModuleOptions) => {
        if (!options.plugins) {
          return [];
        }

        return options.plugins.map((plugin) => {
          if (typeof plugin === "function") {
            return new plugin();
          }
          return plugin;
        });
      },
      inject: [TOKEN_REGISTRY_OPTIONS],
    };
  }

  private static createServiceProvider(): FactoryProvider {
    return {
      provide: TokenRegistryService,
      useFactory: (
        adapter: ITokenStoreAdapter,
        config: TokenRegistryConfig,
        validator: ITokenValidator,
        plugins: ITokenPlugin[] = []
      ) => {
        const service = new TokenRegistryService(adapter, config, validator);

        // Регистрируем плагины
        for (const plugin of plugins) {
          service.registerPlugin(plugin);
        }

        return service;
      },
      inject: [
        TOKEN_STORE_ADAPTER,
        TOKEN_REGISTRY_CONFIG,
        TOKEN_VALIDATOR,
        { token: TOKEN_PLUGINS, optional: true },
      ],
    };
  }

  private static createAsyncServiceProvider(): FactoryProvider {
    return {
      provide: TokenRegistryService,
      useFactory: (
        adapter: ITokenStoreAdapter,
        config: TokenRegistryConfig,
        validator: ITokenValidator,
        plugins: ITokenPlugin[] = []
      ) => {
        const service = new TokenRegistryService(adapter, config, validator);

        // Регистрируем плагины
        for (const plugin of plugins) {
          service.registerPlugin(plugin);
        }

        return service;
      },
      inject: [
        TOKEN_STORE_ADAPTER,
        TOKEN_REGISTRY_CONFIG,
        TOKEN_VALIDATOR,
        { token: TOKEN_PLUGINS, optional: true },
      ],
    };
  }

  private static createAsyncOptionsProvider<T extends ITokenMeta = ITokenMeta>(
    options: TokenRegistryAsyncOptions<T>
  ): FactoryProvider {
    if (options.useFactory) {
      return {
        provide: TOKEN_REGISTRY_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    if (options.useClass) {
      return {
        provide: TOKEN_REGISTRY_OPTIONS,
        useFactory: (optionsInstance: TokenRegistryModuleOptions<T>) =>
          optionsInstance,
        inject: [options.useClass],
      };
    }

    if (options.useExisting) {
      return {
        provide: TOKEN_REGISTRY_OPTIONS,
        useFactory: (optionsInstance: TokenRegistryModuleOptions<T>) =>
          optionsInstance,
        inject: [options.useExisting],
      };
    }

    throw new TokenConfigurationError(
      "Invalid async configuration. Must specify useFactory, useClass, or useExisting."
    );
  }

  // ===================== EXPORTS CREATION =====================

  private static createExports<T extends ITokenMeta = ITokenMeta>(
    options: TokenRegistryModuleOptions<T>
  ): (string | symbol | Type<any>)[] {
    const exports: (string | symbol | Type<any>)[] = [
      TokenRegistryService,
      TOKEN_REGISTRY_CONFIG,
      TOKEN_STORE_ADAPTER,
    ];

    if (options.extraExports) {
      exports.push(...options.extraExports);
    }

    return exports;
  }

  private static createAsyncExports<T extends ITokenMeta = ITokenMeta>(
    options: TokenRegistryAsyncOptions<T>
  ): (string | symbol | Type<any>)[] {
    const exports: (string | symbol | Type<any>)[] = [
      TokenRegistryService,
      TOKEN_REGISTRY_CONFIG,
      TOKEN_STORE_ADAPTER,
    ];

    if (options.extraExports) {
      exports.push(...options.extraExports);
    }

    return exports;
  }

  // ===================== VALIDATION =====================

  private static validateOptions<T extends ITokenMeta = ITokenMeta>(
    options: TokenRegistryModuleOptions<T>
  ): void {
    if (!options) {
      throw new TokenConfigurationError("Module options are required");
    }

    if (!options.storeAdapter) {
      throw new TokenConfigurationError("storeAdapter is required");
    }

    // Валидация конфигурации
    if (options.config) {
      this.validateConfig(options.config);
    }

    // Валидация плагинов
    if (options.plugins) {
      this.validatePlugins(options.plugins);
    }
  }

  private static validateConfig(config: Partial<TokenRegistryConfig>): void {
    if (config.defaultTtl !== undefined) {
      if (!Number.isInteger(config.defaultTtl) || config.defaultTtl <= 0) {
        throw new TokenConfigurationError(
          "defaultTtl must be a positive integer",
          { defaultTtl: config.defaultTtl }
        );
      }
    }

    if (config.operationTimeout !== undefined) {
      if (
        !Number.isInteger(config.operationTimeout) ||
        config.operationTimeout < 0
      ) {
        throw new TokenConfigurationError(
          "operationTimeout must be a non-negative integer",
          { operationTimeout: config.operationTimeout }
        );
      }
    }
  }

  private static validatePlugins(
    plugins: Array<ITokenPlugin | Type<ITokenPlugin>>
  ): void {
    const pluginNames = new Set<string>();

    for (const plugin of plugins) {
      let pluginName: string;

      if (typeof plugin === "function") {
        // Для классов плагинов пытаемся получить имя из прототипа
        pluginName = plugin.name || "UnnamedPlugin";
      } else {
        pluginName = plugin.name;
      }

      if (!pluginName) {
        throw new TokenConfigurationError(
          "All plugins must have a name property"
        );
      }

      if (pluginNames.has(pluginName)) {
        throw new TokenConfigurationError(
          `Duplicate plugin name: ${pluginName}`
        );
      }

      pluginNames.add(pluginName);
    }
  }
}

// ===================== HELPER FUNCTIONS =====================

/**
 * Создает базовый модуль с минимальной конфигурацией
 */
export function createBasicTokenRegistryModule<
  T extends ITokenMeta = ITokenMeta,
>(
  storeAdapter: ITokenStoreAdapter | Type<ITokenStoreAdapter>,
  configOverrides?: Partial<TokenRegistryConfig>
): DynamicModule {
  return TokenRegistryModule.forRoot<T>({
    storeAdapter,
    config: configOverrides,
    isGlobal: true,
  });
}

/**
 * Создает модуль для тестирования с отключенной валидацией
 */
export function createTestTokenRegistryModule<
  T extends ITokenMeta = ITokenMeta,
>(storeAdapter: ITokenStoreAdapter | Type<ITokenStoreAdapter>): DynamicModule {
  return TokenRegistryModule.forRoot<T>({
    storeAdapter,
    config: {
      enableValidation: false,
      enablePlugins: false,
      operationTimeout: 0,
    },
    validator: "none",
    isGlobal: false,
  });
}
