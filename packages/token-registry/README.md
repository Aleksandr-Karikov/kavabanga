# Token Registry Library

Гибкая и расширяемая библиотека для управления refresh токенами в NestJS приложениях.

## Особенности

- ✅ **Минимальный Core** - только базовая функциональность управления токенами
- ✅ **Extension System** - расширение через плагины и extensions
- ✅ **Decorator Pattern** - легкое комбинирование адаптеров
- ✅ **Plugin Architecture** - хуки для расширения функциональности
- ✅ **TypeScript First** - полная типизация
- ✅ **Тестируемость** - легкое тестирование всех компонентов
- ✅ **Production Ready** - error handling, timeouts, failover

## Архитектура

```
src/
├── core/                    # Основная функциональность
│   ├── interfaces.ts        # Интерфейсы и типы
│   ├── service.ts          # Основной сервис
│   └── validators.ts       # Валидаторы
├── adapters/               # Store адаптеры
│   └── base.adapter.ts     # Базовые адаптеры
├── extensions/             # Расширения (session management, analytics)
├── plugins/               # Плагины (metrics, audit, etc.)
└── module.ts             # NestJS модуль
```

## Установка

```bash
npm install @your-org/token-registry
# или
yarn add @your-org/token-registry
```

## Быстрый старт

### Базовое использование

```typescript
import { Module } from "@nestjs/common";
import {
  TokenRegistryModule,
  InMemoryStoreAdapter,
} from "@your-org/token-registry";

@Module({
  imports: [
    TokenRegistryModule.forRoot({
      storeAdapter: new InMemoryStoreAdapter(),
      config: {
        defaultTtl: 30 * 24 * 60 * 60, // 30 дней
        enableValidation: true,
      },
    }),
  ],
})
export class AppModule {}
```

### Использование в сервисе

```typescript
import { Injectable } from "@nestjs/common";
import { TokenRegistryService } from "@your-org/token-registry";

@Injectable()
export class AuthService {
  constructor(private readonly tokenRegistry: TokenRegistryService) {}

  async createRefreshToken(
    userId: string,
    deviceId: string,
    ipAddress: string
  ): Promise<string> {
    const token = this.generateSecureToken();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 дней

    await this.tokenRegistry.saveToken(token, {
      sub: userId,
      issuedAt: Date.now(),
      expiresAt,
      meta: {
        deviceId,
        ipAddress,
        userAgent: "MyApp/1.0",
      },
    });

    return token;
  }

  async validateRefreshToken(token: string): Promise<boolean> {
    const data = await this.tokenRegistry.getTokenData(token);

    if (!data) {
      return false;
    }

    // Проверяем срок действия
    if (data.expiresAt < Date.now()) {
      await this.tokenRegistry.revokeToken(token);
      return false;
    }

    return true;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await this.tokenRegistry.revokeToken(token);
  }

  private generateSecureToken(): string {
    // Ваша логика генерации токена
    return "secure-random-token";
  }
}
```

## Продвинутое использование

### Цепочка адаптеров

```typescript
import {
  TokenRegistryModule,
  LoggingStoreAdapter,
  FailoverStoreAdapter,
  InMemoryStoreAdapter,
} from "@your-org/token-registry";

@Module({
  imports: [
    TokenRegistryModule.forRoot({
      storeAdapter: new LoggingStoreAdapter(
        new FailoverStoreAdapter(
          new RedisStoreAdapter(primaryRedis),
          new InMemoryStoreAdapter() // fallback
        )
      ),
      config: {
        enableValidation: true,
        operationTimeout: 5000,
      },
    }),
  ],
})
export class AppModule {}
```

### Кастомный адаптер

```typescript
import {
  BaseStoreAdapter,
  TokenSaveRequest,
  TokenData,
} from "@your-org/token-registry";

export class DatabaseStoreAdapter extends BaseStoreAdapter {
  constructor(private readonly database: Database) {
    super();
  }

  async saveToken(request: TokenSaveRequest): Promise<void> {
    try {
      await this.database.tokens.create({
        token: request.token,
        data: JSON.stringify(request.data),
        expiresAt: new Date(Date.now() + request.ttl * 1000),
      });
    } catch (error) {
      this.handleError("saveToken", error);
    }
  }

  async getTokenData(token: string): Promise<TokenData | null> {
    try {
      const record = await this.database.tokens.findByToken(token);

      if (!record || record.expiresAt < new Date()) {
        return null;
      }

      return JSON.parse(record.data);
    } catch (error) {
      this.handleError("getTokenData", error);
    }
  }

  async deleteToken(token: string): Promise<void> {
    try {
      await this.database.tokens.deleteByToken(token);
    } catch (error) {
      this.handleError("deleteToken", error);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.database.raw("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
```

### Кастомные плагины

```typescript
import { ITokenPlugin, TokenSaveRequest } from "@your-org/token-registry";

export class AuditPlugin implements ITokenPlugin {
  name = "AuditPlugin";
  priority = 100;

  async postSave(request: TokenSaveRequest): Promise<void> {
    // Логируем создание токена
    console.log(`Token created for user: ${request.data.sub}`);
  }

  async postRevoke(token: string, data: TokenData): Promise<void> {
    // Логируем удаление токена
    console.log(`Token revoked for user: ${data.sub}`);
  }

  async onError(operation: string, error: Error): Promise<void> {
    // Логируем ошибки
    console.error(`Error in ${operation}:`, error);
  }
}
```

### Кастомный валидатор

```typescript
import {
  ITokenValidator,
  TokenSaveRequest,
  TokenValidationError,
} from "@your-org/token-registry";

export class CompanyValidator implements ITokenValidator {
  async validate(request: TokenSaveRequest): Promise<void> {
    // Кастомная валидация для вашей компании
    if (!request.data.meta.companyId) {
      throw new TokenValidationError("companyId is required");
    }

    if (!request.data.meta.department) {
      throw new TokenValidationError("department is required");
    }

    // Проверка корпоративной политики
    if (request.ttl > 7 * 24 * 60 * 60) {
      // 7 дней максимум
      throw new TokenValidationError("TTL exceeds company policy (max 7 days)");
    }
  }
}
```

### Асинхронная конфигурация

```typescript
@Module({
  imports: [
    ConfigModule.forRoot(),
    TokenRegistryModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get("REDIS_URL");
        const redis = new Redis(redisUrl);

        return {
          storeAdapter: new RedisStoreAdapter(redis),
          config: {
            defaultTtl: configService.get("TOKEN_TTL", 30 * 24 * 60 * 60),
            enableValidation: configService.get("ENABLE_VALIDATION", true),
            strictMode: configService.get("STRICT_MODE", false),
          },
          plugins: [new AuditPlugin(), new MetricsPlugin()],
        };
      },
      inject: [ConfigService],
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

## Тестирование

```typescript
import { Test } from "@nestjs/testing";
import {
  TokenRegistryService,
  createTestTokenRegistryModule,
  InMemoryStoreAdapter,
} from "@your-org/token-registry";

describe("AuthService", () => {
  let authService: AuthService;
  let tokenRegistry: TokenRegistryService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [createTestTokenRegistryModule(new InMemoryStoreAdapter())],
      providers: [AuthService],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    tokenRegistry = module.get<TokenRegistryService>(TokenRegistryService);
  });

  it("should create and validate refresh token", async () => {
    const token = await authService.createRefreshToken(
      "user123",
      "device456",
      "192.168.1.1"
    );

    expect(token).toBeDefined();

    const isValid = await authService.validateRefreshToken(token);
    expect(isValid).toBe(true);
  });

  it("should revoke token", async () => {
    const token = await authService.createRefreshToken(
      "user123",
      "device456",
      "192.168.1.1"
    );

    await authService.revokeRefreshToken(token);

    const isValid = await authService.validateRefreshToken(token);
    expect(isValid).toBe(false);
  });
});
```

## API Reference

### Core Interfaces

#### `ITokenStoreAdapter`

Базовый интерфейс для всех store адаптеров.

```typescript
interface ITokenStoreAdapter {
  saveToken(request: TokenSaveRequest): Promise<void>;
  getTokenData(token: string): Promise<TokenData | null>;
  deleteToken(token: string): Promise<void>;
  saveBatchTokens(requests: TokenSaveRequest[]): Promise<void>;
  isHealthy(): Promise<boolean>;
}
```

#### `TokenData`

Структура данных токена.

```typescript
interface TokenData<T extends ITokenMeta = ITokenMeta> {
  sub: string; // subject (user ID)
  issuedAt: number; // timestamp
  expiresAt: number; // timestamp
  meta: T; // дополнительные данные
  version?: string; // версия токена (опционально)
}
```

#### `ITokenPlugin`

Интерфейс для плагинов.

```typescript
interface ITokenPlugin<T extends ITokenMeta = ITokenMeta> {
  readonly name: string;
  readonly priority: number;

  preSave?(request: TokenSaveRequest<T>): Promise<TokenSaveRequest<T>>;
  postSave?(request: TokenSaveRequest<T>): Promise<void>;
  preGet?(token: string): Promise<void>;
  postGet?(token: string, data: TokenData<T> | null): Promise<void>;
  preRevoke?(token: string, data: TokenData<T>): Promise<void>;
  postRevoke?(token: string, data: TokenData<T>): Promise<void>;
  onError?(operation: string, error: Error, context?: any): Promise<void>;
}
```

### Configuration

#### `TokenRegistryConfig`

```typescript
interface TokenRegistryConfig {
  enableValidation: boolean; // включить валидацию (по умолчанию: true)
  defaultTtl: number; // TTL по умолчанию в секундах (по умолчанию: 30 дней)
  enablePlugins: boolean; // включить плагины (по умолчанию: true)
  strictMode: boolean; // строгий режим (по умолчанию: false)
  operationTimeout: number; // таймаут операций в мс (по умолчанию: 5000)
}
```

## Лучшие практики

### Безопасность

1. **Используйте строгую валидацию в production**:

```typescript
{
  validator: new StrictTokenValidator(config),
  config: { strictMode: true }
}
```

2. **Ограничивайте TTL токенов**:

```typescript
{
  config: {
    defaultTtl: 7 * 24 * 60 * 60, // максимум 7 дней
  }
}
```

3. **Используйте audit плагины для логирования**:

```typescript
plugins: [new AuditPlugin(), new SecurityPlugin()];
```

### Производительность

1. **Используйте пакетные операции**:

```typescript
await tokenRegistry.saveBatchTokens(tokenRequests);
```

2. **Настройте failover для критических систем**:

```typescript
new FailoverStoreAdapter(primaryAdapter, fallbackAdapter);
```

3. **Используйте таймауты**:

```typescript
{
  config: {
    operationTimeout: 3000;
  }
}
```

### Мониторинг

1. **Добавьте метрики**:

```typescript
plugins: [new MetricsPlugin()];
```

2. **Используйте health checks**:

```typescript
const isHealthy = await tokenRegistry.getHealthStatus();
```

3. **Логируйте операции**:

```typescript
new LoggingStoreAdapter(baseAdapter, customLogger);
```

## Roadmap

- [ ] Redis Store Adapter
- [ ] Session Management Extension
- [ ] Analytics Extension
- [ ] Rate Limiting Plugin
- [ ] Circuit Breaker Decorator
- [ ] Encryption Plugin
- [ ] Prometheus Metrics

## Лицензия

MIT License
