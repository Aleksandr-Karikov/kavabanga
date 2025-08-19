# Token Registry Core

Простая и надежная библиотека для управления refresh токенами.

## Особенности

- ✅ **Простота** - минимальный API для основных операций
- ✅ **TypeScript First** - полная типизация
- ✅ **Event-driven** - простые event handlers для расширения
- ✅ **Production Ready** - таймауты, health checks, graceful shutdown
- ✅ **Легко тестировать** - встроенный memory store для тестов

## Быстрая установка

```bash
npm install @kavabanga/token-registry-core
```

## Быстрый старт

### Базовое использование

```typescript
import {
  TokenRegistryService,
  InMemoryStore,
  DefaultTokenValidator,
  DEFAULT_CONFIG,
} from "@kavabanga/token-registry-core";

// Создаем сервис
const store = new InMemoryStore();
const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
const tokenRegistry = new TokenRegistryService(
  store,
  DEFAULT_CONFIG,
  validator
);

// Сохраняем токен
await tokenRegistry.saveToken("token123", {
  sub: "user123",
  issuedAt: Date.now(),
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 дней
  meta: {
    deviceId: "device456",
    ipAddress: "192.168.1.1",
  },
});

// Получаем данные токена
const data = await tokenRegistry.getTokenData("token123");
console.log(data); // TokenData или null

// Удаляем токен
await tokenRegistry.revokeToken("token123");
```

### Использование в NestJS

```typescript
import { Module } from "@nestjs/common";
import {
  TokenRegistryService,
  InMemoryStore,
  DefaultTokenValidator,
  DEFAULT_CONFIG,
} from "@kavabanga/token-registry-core";

@Module({
  providers: [
    {
      provide: TokenRegistryService,
      useFactory: () => {
        const store = new InMemoryStore();
        const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
        return new TokenRegistryService(store, DEFAULT_CONFIG, validator);
      },
    },
  ],
  exports: [TokenRegistryService],
})
export class TokenRegistryModule {}
```

### Event Handlers

```typescript
import { TokenEventHandler } from "@kavabanga/token-registry-core";

class AuditHandler implements TokenEventHandler {
  async onTokenCreated(token: string, data: TokenData): Promise<void> {
    console.log(`Token created for user: ${data.sub}`);
  }

  async onTokenAccessed(token: string, data: TokenData): Promise<void> {
    console.log(`Token accessed for user: ${data.sub}`);
  }

  async onTokenRevoked(token: string, data: TokenData): Promise<void> {
    console.log(`Token revoked for user: ${data.sub}`);
  }
}

// Регистрируем handler
tokenRegistry.registerEventHandler(new AuditHandler());
```

### Кастомный Store

```typescript
import { ITokenStore, TokenData } from "@kavabanga/token-registry-core";

class RedisStore implements ITokenStore {
  constructor(private redis: Redis) {}

  async save(token: string, data: TokenData, ttl: number): Promise<void> {
    await this.redis.setex(token, ttl, JSON.stringify(data));
  }

  async get(token: string): Promise<TokenData | null> {
    const data = await this.redis.get(token);
    return data ? JSON.parse(data) : null;
  }

  async delete(token: string): Promise<void> {
    await this.redis.del(token);
  }

  async health(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}
```

### Кастомный Validator

```typescript
import {
  ITokenValidator,
  TokenData,
  TokenValidationError,
} from "@kavabanga/token-registry-core";

class CompanyValidator implements ITokenValidator {
  async validate(token: string, data: TokenData, ttl: number): Promise<void> {
    // Проверяем обязательные поля
    if (!data.meta.companyId) {
      throw new TokenValidationError("companyId is required");
    }

    // Проверяем корпоративную политику
    if (ttl > 7 * 24 * 60 * 60) {
      // 7 дней максимум
      throw new TokenValidationError("TTL exceeds company policy (max 7 days)");
    }
  }
}
```

## API Reference

### TokenRegistryService

Основной сервис для управления токенами.

```typescript
class TokenRegistryService<T extends ITokenMeta = ITokenMeta> {
  constructor(
    store: ITokenStore,
    config: TokenRegistryConfig,
    validator: ITokenValidator<T>
  );

  // Основные методы
  saveToken(token: string, data: TokenData<T>, ttl?: number): Promise<void>;
  getTokenData(token: string): Promise<TokenData<T> | null>;
  revokeToken(token: string): Promise<void>;
  getHealthStatus(): Promise<boolean>;
  shutdown(): Promise<void>;

  // Event handlers
  registerEventHandler(handler: TokenEventHandler<T>): void;
  unregisterEventHandler(handler: TokenEventHandler<T>): void;
}
```

### ITokenStore

Интерфейс для хранилища токенов.

```typescript
interface ITokenStore {
  save(token: string, data: TokenData, ttl: number): Promise<void>;
  get(token: string): Promise<TokenData | null>;
  delete(token: string): Promise<void>;
  health(): Promise<boolean>;
}
```

### TokenData

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

### TokenRegistryConfig

Конфигурация сервиса.

```typescript
interface TokenRegistryConfig {
  enableValidation: boolean; // включить валидацию (по умолчанию: true)
  defaultTtl: number; // TTL по умолчанию в секундах (по умолчанию: 30 дней)
  enableEvents: boolean; // включить event handlers (по умолчанию: true)
  operationTimeout: number; // таймаут операций в мс (по умолчанию: 5000)
}
```

## Тестирование

```typescript
import {
  TokenRegistryService,
  createTestMemoryStore,
  DefaultTokenValidator,
  DEFAULT_CONFIG,
} from "@kavabanga/token-registry-core";

describe("TokenRegistryService", () => {
  let service: TokenRegistryService;
  let store: InMemoryStore;

  beforeEach(() => {
    store = createTestMemoryStore();
    const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
    service = new TokenRegistryService(store, DEFAULT_CONFIG, validator);
  });

  it("should save and retrieve token", async () => {
    const token = "test-token";
    const data = {
      sub: "user123",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: { deviceId: "device123" },
    };

    await service.saveToken(token, data);
    const retrieved = await service.getTokenData(token);

    expect(retrieved).toEqual(data);
  });

  it("should revoke token", async () => {
    const token = "test-token";
    const data = {
      sub: "user123",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: { deviceId: "device123" },
    };

    await service.saveToken(token, data);
    await service.revokeToken(token);

    const retrieved = await service.getTokenData(token);
    expect(retrieved).toBeNull();
  });
});
```

## Лучшие практики

### Безопасность

1. **Используйте валидацию в production**:

```typescript
const config = { ...DEFAULT_CONFIG, enableValidation: true };
```

2. **Ограничивайте TTL токенов**:

```typescript
const config = { ...DEFAULT_CONFIG, defaultTtl: 7 * 24 * 60 * 60 }; // 7 дней
```

3. **Используйте event handlers для аудита**:

```typescript
tokenRegistry.registerEventHandler(new AuditHandler());
```

### Производительность

1. **Настройте таймауты**:

```typescript
const config = { ...DEFAULT_CONFIG, operationTimeout: 3000 };
```

2. **Используйте health checks**:

```typescript
const isHealthy = await tokenRegistry.getHealthStatus();
```

## Roadmap

### Фаза 1: Основные адаптеры (Q1 2024)

- [x] **Core Package** - базовая функциональность
- [ ] **Redis Store** - Redis адаптер для production
- [ ] **PostgreSQL Store** - база данных для enterprise

### Фаза 2: Production компоненты (Q2 2024)

- [ ] **Circuit Breaker** - защита от каскадных отказов
- [ ] **Metrics** - Prometheus метрики
- [ ] **Caching** - LRU кэширование

### Фаза 3: Расширенная функциональность (Q3 2024)

- [ ] **Session Management** - управление сессиями
- [ ] **Analytics** - аналитика использования
- [ ] **CLI Tools** - командная строка управления

## Лицензия

MIT License
