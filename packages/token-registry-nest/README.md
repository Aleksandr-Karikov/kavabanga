# @kavabanga/token-registry-nest

NestJS модуль для интеграции token registry системы с поддержкой любых адаптеров через фабричную функцию.

## Установка

```bash
yarn add @kavabanga/token-registry-nest
```

## Быстрый старт

### 1. Базовое использование с Memory Store (по умолчанию)

```typescript
import { Module } from "@nestjs/common";
import { TokenRegistryModule } from "@kavabanga/token-registry-nest";

@Module({
  imports: [
    TokenRegistryModule.forRoot({
      config: {
        defaultTtl: 30 * 24 * 60 * 60, // 30 дней
        enableValidation: true,
        enableEvents: true,
      },
    }),
  ],
})
export class AppModule {}
```

### 2. Использование с Redis Store

```typescript
import { Module } from "@nestjs/common";
import { TokenRegistryModule } from "@kavabanga/token-registry-nest";
import { createIoredisStore } from "@kavabanga/token-registry-ioredis";
import Redis from "ioredis";

@Module({
  imports: [
    TokenRegistryModule.forRoot({
      storeFactory: () => {
        const redis = new Redis({
          host: "localhost",
          port: 6379,
        });
        return createIoredisStore(redis, { keyPrefix: "refresh-tokens" });
      },
      config: {
        defaultTtl: 30 * 24 * 60 * 60,
        enableValidation: true,
        enableEvents: true,
      },
    }),
  ],
})
export class AppModule {}
```

### 3. Использование с ConfigService

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TokenRegistryModule } from "@kavabanga/token-registry-nest";
import { createIoredisStore } from "@kavabanga/token-registry-ioredis";
import Redis from "ioredis";

@Module({
  imports: [
    ConfigModule.forRoot(),
    TokenRegistryModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        storeFactory: () => {
          const redis = new Redis(configService.get<string>("REDIS_URL"));
          return createIoredisStore(redis, {
            keyPrefix: configService.get<string>("TOKEN_PREFIX", "tokens"),
          });
        },
        config: {
          defaultTtl: configService.get<number>("TOKEN_TTL", 30 * 24 * 60 * 60),
          enableValidation: configService.get<boolean>(
            "TOKEN_VALIDATION",
            true
          ),
          enableEvents: configService.get<boolean>("TOKEN_EVENTS", true),
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### 4. Использование в сервисе

```typescript
import { Injectable } from "@nestjs/common";
import {
  TokenRegistryService,
  InjectTokenRegistry,
  TokenData,
  ITokenMeta,
} from "@kavabanga/token-registry-nest";

interface CustomTokenMeta extends ITokenMeta {
  deviceId: string;
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectTokenRegistry()
    private readonly tokenRegistry: TokenRegistryService<CustomTokenMeta>
  ) {}

  async saveRefreshToken(
    token: string,
    userId: string,
    meta: CustomTokenMeta
  ): Promise<void> {
    const tokenData: TokenData<CustomTokenMeta> = {
      sub: userId,
      issuedAt: Date.now(),
      meta,
    };

    await this.tokenRegistry.saveToken(token, tokenData);
  }

  async getTokenData(
    token: string
  ): Promise<TokenData<CustomTokenMeta> | null> {
    return this.tokenRegistry.getTokenData(token);
  }

  async revokeToken(token: string): Promise<void> {
    await this.tokenRegistry.revokeToken(token);
  }

  async checkHealth(): Promise<boolean> {
    return this.tokenRegistry.getHealthStatus();
  }
}
```

## Конфигурация Store

### Memory Store (по умолчанию)

```typescript
import { createMemoryStore } from "@kavabanga/token-registry-core";

TokenRegistryModule.forRoot({
  storeFactory: () => createMemoryStore(),
});
```

### Redis Store

```typescript
import { createIoredisStore } from "@kavabanga/token-registry-ioredis";
import Redis from "ioredis";

// Одиночный Redis сервер
TokenRegistryModule.forRoot({
  storeFactory: () => {
    const redis = new Redis({
      host: "localhost",
      port: 6379,
      password: "your-password",
      db: 0,
    });
    return createIoredisStore(redis, { keyPrefix: "refresh-tokens" });
  },
});

// Redis URL
TokenRegistryModule.forRoot({
  storeFactory: () => {
    const redis = new Redis("redis://username:password@localhost:6379/0");
    return createIoredisStore(redis, { keyPrefix: "tokens" });
  },
});

// Redis Cluster
TokenRegistryModule.forRoot({
  storeFactory: () => {
    const cluster = new Redis.Cluster([
      { host: "localhost", port: 7000 },
      { host: "localhost", port: 7001 },
      { host: "localhost", port: 7002 },
    ]);
    return createIoredisStore(cluster, { keyPrefix: "cluster-tokens" });
  },
});

// Redis Sentinel
TokenRegistryModule.forRoot({
  storeFactory: () => {
    const sentinel = new Redis({
      sentinels: [
        { host: "localhost", port: 26379 },
        { host: "localhost", port: 26380 },
        { host: "localhost", port: 26381 },
      ],
      name: "mymaster",
    });
    return createIoredisStore(sentinel, { keyPrefix: "sentinel-tokens" });
  },
});
```

### Custom Store

```typescript
import { ITokenStore, TokenData } from "@kavabanga/token-registry-core";

class MyCustomStore implements ITokenStore {
  async save(token: string, data: TokenData, ttl: number): Promise<void> {
    // Ваша логика сохранения
  }

  async get(token: string): Promise<TokenData | null> {
    // Ваша логика получения
  }

  async delete(token: string): Promise<void> {
    // Ваша логика удаления
  }

  async health(): Promise<boolean> {
    // Ваша логика проверки здоровья
  }
}

TokenRegistryModule.forRoot({
  storeFactory: () => new MyCustomStore(),
});
```

### Database Store

```typescript
import { ITokenStore, TokenData } from "@kavabanga/token-registry-core";

class DatabaseStore implements ITokenStore {
  constructor(private readonly db: any) {}

  async save(token: string, data: TokenData, ttl: number): Promise<void> {
    await this.db.tokens.upsert({
      where: { token },
      update: {
        data: JSON.stringify(data),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
      create: {
        token,
        data: JSON.stringify(data),
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });
  }

  async get(token: string): Promise<TokenData | null> {
    const record = await this.db.tokens.findUnique({
      where: { token },
    });

    if (!record || record.expiresAt < new Date()) {
      return null;
    }

    return JSON.parse(record.data);
  }

  async delete(token: string): Promise<void> {
    await this.db.tokens.delete({
      where: { token },
    });
  }

  async health(): Promise<boolean> {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

TokenRegistryModule.forRoot({
  storeFactory: () => new DatabaseStore(prisma),
});
```

## Event Handlers

```typescript
import { Injectable } from "@nestjs/common";
import {
  TokenRegistryService,
  InjectTokenRegistry,
  TokenEventHandler,
  TokenData,
} from "@kavabanga/token-registry-nest";

@Injectable()
export class TokenEventHandlerService implements TokenEventHandler {
  constructor(
    @InjectTokenRegistry()
    private readonly tokenRegistry: TokenRegistryService
  ) {
    // Регистрируем обработчик событий
    this.tokenRegistry.registerEventHandler(this);
  }

  async onTokenCreated(token: string, data: TokenData): Promise<void> {
    console.log(`Token created: ${token} for user: ${data.sub}`);
    // Логика при создании токена
  }

  async onTokenAccessed(token: string, data: TokenData): Promise<void> {
    console.log(`Token accessed: ${token} for user: ${data.sub}`);
    // Логика при обращении к токену
  }

  async onTokenRevoked(token: string, data: TokenData): Promise<void> {
    console.log(`Token revoked: ${token} for user: ${data.sub}`);
    // Логика при отзыве токена
  }
}
```

## Обработка ошибок

```typescript
import { Injectable, Logger } from "@nestjs/common";
import {
  TokenRegistryService,
  InjectTokenRegistry,
  TokenNotFoundError,
  TokenValidationError,
  TokenOperationError,
} from "@kavabanga/token-registry-nest";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectTokenRegistry()
    private readonly tokenRegistry: TokenRegistryService
  ) {}

  async getTokenData(token: string) {
    try {
      return await this.tokenRegistry.getTokenData(token);
    } catch (error) {
      if (error instanceof TokenNotFoundError) {
        this.logger.warn(`Token not found: ${token}`);
        return null;
      }

      if (error instanceof TokenValidationError) {
        this.logger.error(`Token validation failed: ${error.message}`);
        throw error;
      }

      if (error instanceof TokenOperationError) {
        this.logger.error(`Token operation failed: ${error.message}`);
        throw error;
      }

      throw error;
    }
  }
}
```

## Health Check

```typescript
import { Injectable } from "@nestjs/common";
import {
  TokenRegistryService,
  InjectTokenRegistry,
} from "@kavabanga/token-registry-nest";

@Injectable()
export class HealthService {
  constructor(
    @InjectTokenRegistry()
    private readonly tokenRegistry: TokenRegistryService
  ) {}

  async checkTokenRegistryHealth(): Promise<boolean> {
    return this.tokenRegistry.getHealthStatus();
  }
}
```

## Миграция с существующего Redis

Если у вас уже есть настроенный Redis в приложении, вы можете использовать его:

```typescript
import { Module } from "@nestjs/common";
import { RedisModule } from "@nestjs-modules/ioredis";
import { TokenRegistryModule } from "@kavabanga/token-registry-nest";
import { createIoredisStore } from "@kavabanga/token-registry-ioredis";

@Module({
  imports: [
    // Ваш существующий Redis
    RedisModule.forRoot({
      type: "single",
      url: "redis://localhost:6379",
    }),

    // Token Registry с использованием существующего Redis
    TokenRegistryModule.forRoot({
      storeFactory: (redis: Redis) =>
        createIoredisStore(redis, { keyPrefix: "refresh-tokens" }),
      config: {
        defaultTtl: 30 * 24 * 60 * 60,
      },
    }),
  ],
})
export class AppModule {}
```

## API Reference

### TokenRegistryService

#### Методы

- `saveToken(token: string, data: TokenData<T>, ttl?: number): Promise<void>`
- `getTokenData(token: string): Promise<TokenData<T> | null>`
- `revokeToken(token: string): Promise<void>`
- `getHealthStatus(): Promise<boolean>`
- `registerEventHandler(handler: TokenEventHandler<T>): void`
- `unregisterEventHandler(handler: TokenEventHandler<T>): void`
- `getStore(): ITokenStore`
- `getConfig(): TokenRegistryConfig`
- `getRegisteredEventHandlers(): readonly TokenEventHandler<T>[]`

### Декораторы

- `@InjectTokenRegistry()` - инъекция сервиса token registry

### Константы

- `TOKEN_REGISTRY_SERVICE` - токен для инъекции сервиса
- `TOKEN_REGISTRY_MODULE_OPTIONS` - токен для опций модуля

### Типы

- `TokenRegistryModuleOptions` - опции модуля
- `TokenRegistryModuleAsyncOptions` - асинхронные опции модуля
- `TokenRegistryServiceOptions` - опции сервиса
