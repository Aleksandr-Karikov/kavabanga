# Token Registry

Гибкая и расширяемая библиотека для управления refresh токенами в NestJS приложениях.

## Пакеты экосистемы

Библиотека Token Registry построена по модульному принципу:

- **`@kavabanga/token-registry-core`** - ⚡ Основной пакет (этот пакет)
- **`@kavabanga/token-registry-redis`** - 🔗 Redis адаптеры (ioredis, searchable)
- **`@kavabanga/token-registry-cache`** - 💾 LRU кэширование
- **`@kavabanga/token-registry-opossum`** - 🔒 Circuit breaker с использованием Opossum
- **`@kavabanga/token-registry-prometheus`** - 📊 Prometheus метрики

## Особенности

- ✅ **Модульная архитектура** - устанавливайте только то, что нужно
- ✅ **TypeScript First** - полная типизация
- ✅ **Plugin Architecture** - расширяемость через плагины
- ✅ **Decorator Pattern** - комбинирование адаптеров
- ✅ **Production Ready** - circuit breakers, метрики, failover
- ✅ **NestJS Integration** - нативная интеграция с NestJS

## Быстрая установка

```bash
# Основной пакет с core функциональностью
npm install @kavabanga/token-registry-core

# Дополнительные адаптеры (по необходимости)
```

## Модульная установка

Вы можете устанавливать только нужные компоненты:

```bash
# Минимальная установка - только core
npm install @kavabanga/token-registry

```

## Быстрый старт

### Базовое использование

```typescript
import { Module } from "@nestjs/common";
import {
  TokenRegistryModule,
  InMemoryStoreAdapter,
} from "@kavabanga/token-registry";

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

### Фаза 1: Основные адаптеры (Q1 2024)

🎯 **Цель**: Завершить базовую функциональность для production

#### Core Package (`@kavabanga/token-registry-core`) - ✅ ГОТОВО

- [x] Базовые интерфейсы и типы
- [x] Основной сервис TokenRegistryService
- [x] NestJS модуль интеграция
- [x] In-memory адаптер для разработки
- [x] Система валидации (Default, Strict, NoOp)
- [x] Паттерн Decorator для адаптеров
- [x] Система плагинов и расширений

#### Redis Package (`@kavabanga/token-registry-redis`) - 🔄 В РАЗРАБОТКЕ

- [ ] **RedisStoreAdapter** - базовый Redis адаптер (ioredis)
  - [ ] Основные операции (save, get, delete, batch)
  - [ ] TTL и автоматическое истечение токенов
  - [ ] Connection pooling и reconnection
  - [ ] Health checks
- [ ] **SearchableRedisAdapter** - расширенный адаптер с поиском
  - [ ] Поиск токенов по userId/deviceId/IP
  - [ ] Индексирование метаданных
  - [ ] Batch операции поиска и очистки
- [ ] **ClusterRedisAdapter** - для Redis Cluster
  - [ ] Sharding стратегии
  - [ ] Failover между узлами
- [ ] **SentinelRedisAdapter** - для Redis Sentinel
  - [ ] Автоматическая смена master
  - [ ] Балансировка нагрузки на replica

### Фаза 2: Production-ready компоненты (Q2 2024)

#### Resilience Package (`@kavabanga/token-registry-resilience`)

- [ ] **CircuitBreakerDecorator** - защита от каскадных отказов
  - [ ] Интеграция с opossum
  - [ ] Настраиваемые пороги и стратегии
  - [ ] Metrics и мониторинг состояния
- [ ] **RetryDecorator** - повторные попытки с backoff
  - [ ] Exponential backoff стратегии
  - [ ] Настраиваемые условия retry
- [ ] **FailoverDecorator** - переключение между адаптерами
  - [ ] Автоматический failover
  - [ ] Health check мониторинг
  - [ ] Primary/Secondary стратегии
- [ ] **TimeoutDecorator** - таймауты операций
  - [ ] Настраиваемые лимиты по операциям
  - [ ] Graceful degradation

#### Cache Package (`@kavabanga/token-registry-cache`)

- [ ] **LRUCacheDecorator** - LRU кэширование
  - [ ] Настраиваемый размер кэша
  - [ ] TTL для кэшированных записей
  - [ ] Metrics кэша (hit rate, size)
- [ ] **WriteThroughCacheDecorator** - write-through стратегия
- [ ] **WriteBackCacheDecorator** - write-back стратегия
- [ ] **Multi-level cache** - многоуровневое кэширование

### Фаза 3: Мониторинг и безопасность (Q3 2024)

#### Metrics Package (`@kavabanga/token-registry-prometheus`)

- [ ] **PrometheusMetricsPlugin** - Prometheus интеграция
  - [ ] Стандартные метрики (operations, latency, errors)
  - [ ] Business метрики (active tokens, user sessions)
  - [ ] Настраиваемые labels и buckets
- [ ] **MetricsCollectorDecorator** - сбор метрик
- [ ] **HealthCheckEndpoint** - health check API
- [ ] **Grafana Dashboard** - готовый dashboard

#### Security Package (`@kavabanga/token-registry-security`)

- [ ] **EncryptionDecorator** - шифрование токенов
  - [ ] AES-256 encryption
  - [ ] Key rotation support
  - [ ] Настраиваемые алгоритмы
- [ ] **AuditPlugin** - аудит операций
  - [ ] Логирование всех операций
  - [ ] Structured logs (JSON)
  - [ ] Интеграция с внешними системами аудита
- [ ] **RateLimitingPlugin** - ограничение частоты
  - [ ] Per-user rate limiting
  - [ ] IP-based limiting
  - [ ] Sliding window algorithms
- [ ] **SecurityValidator** - дополнительные проверки безопасности
  - [ ] Suspicious IP detection
  - [ ] Device fingerprinting validation
  - [ ] Token entropy analysis

### Фаза 4: Расширенная функциональность (Q4 2024)

#### Analytics Package (`@kavabanga/token-registry-analytics`)

- [ ] **AnalyticsExtension** - аналитика использования
  - [ ] User session analytics
  - [ ] Device tracking
  - [ ] Geographic analysis
  - [ ] Usage patterns detection
- [ ] **ReportingService** - генерация отчетов
- [ ] **DataExportService** - экспорт данных
- [ ] **DashboardAPI** - API для дашбордов

#### Session Management (`@kavabanga/token-registry-sessions`)

- [ ] **SessionManagerExtension** - управление сессиями
  - [ ] Multi-device session management
  - [ ] Session limits per user
  - [ ] Concurrent session control
- [ ] **SessionCleanupService** - очистка неактивных сессий
- [ ] **DeviceManagementAPI** - управление устройствами
- [ ] **SessionNotificationService** - уведомления о сессиях

#### Database Adapters Package (`@kavabanga/token-registry-db`)

- [ ] **PostgreSQLAdapter** - PostgreSQL хранилище
  - [ ] Optimized schema design
  - [ ] Partitioning strategies
  - [ ] Full-text search capabilities
- [ ] **MongoDBAdapter** - MongoDB хранилище
  - [ ] Document-based storage
  - [ ] Aggregation pipelines для аналитики
- [ ] **DynamoDBAdapter** - AWS DynamoDB
  - [ ] Auto-scaling configuration
  - [ ] GSI для efficient queries

### Фаза 5: Экосистема и интеграции (Q1 2025)

#### Testing Package (`@kavabanga/token-registry-testing`)

- [ ] **TestUtilities** - утилиты для тестирования
  - [ ] Mock adapters
  - [ ] Test data generators
  - [ ] Performance test helpers
- [ ] **E2E Test Suite** - комплексные тесты
- [ ] **Load Testing Tools** - нагрузочное тестирование

#### CLI Package (`@kavabanga/token-registry-cli`)

- [ ] **Management CLI** - командная строка управления
  - [ ] Token management commands
  - [ ] Migration tools
  - [ ] Health check utilities
- [ ] **Migration Tools** - инструменты миграции
- [ ] **Backup/Restore** - резервное копирование

#### Integration Packages

- [ ] **Express Middleware** (`@kavabanga/token-registry-express`)
- [ ] **Fastify Plugin** (`@kavabanga/token-registry-fastify`)
- [ ] **GraphQL Integration** (`@kavabanga/token-registry-graphql`)
- [ ] **Microservices Templates** - готовые шаблоны

### Фаза 6: Enterprise функции (Q2 2025)

#### Enterprise Package (`@kavabanga/token-registry-enterprise`)

- [ ] **Multi-tenancy Support** - поддержка мультитенантности
- [ ] **Advanced Encryption** - продвинутое шифрование
- [ ] **Compliance Tools** - инструменты соответствия
- [ ] **Enterprise Analytics** - корпоративная аналитика

### Приоритеты разработки

**🔴 High Priority (MVP)**

1. RedisStoreAdapter - критично для production
2. CircuitBreakerDecorator - надежность системы
3. PrometheusMetricsPlugin - мониторинг
4. AuditPlugin - безопасность и соответствие

**🟡 Medium Priority**

1. SearchableRedisAdapter - расширенные возможности
2. LRUCacheDecorator - производительность
3. AnalyticsExtension - business value
4. SessionManagerExtension - user experience

**🟢 Low Priority**

1. Database adapters - alternative storage
2. CLI tools - development experience
3. Integration packages - ecosystem growth
4. Enterprise features - large customers

### Инфраструктура монорепозитория

#### Yarn Workspace структура

```
packages/
├── token-registry-core/          # ✅ Готово
├── token-registry-redis/         # 🔄 В разработке
├── token-registry-resilience/    # 📋 Планируется
├── token-registry-cache/         # 📋 Планируется
├── token-registry-prometheus/    # 📋 Планируется
├── token-registry-security/      # 📋 Планируется
├── token-registry-analytics/     # 📋 Планируется
├── token-registry-sessions/      # 📋 Планируется
├── token-registry-db/           # 📋 Планируется
├── token-registry-testing/      # 📋 Планируется
├── token-registry-cli/          # 📋 Планируется
└── token-registry-enterprise/   # 📋 Планируется
```

#### Development Workflow

- [ ] **Shared tooling** - единые ESLint, TypeScript, Jest конфиги
- [ ] **Automated testing** - CI/CD для всех пакетов
- [ ] **Automated publishing** - semantic versioning и NPM publishing
- [ ] **Documentation** - автогенерация API docs
- [ ] **Examples repository** - примеры использования

### Метрики успеха

**Technical Metrics**

- Code coverage > 90% для всех пакетов
- Performance: < 1ms latency для memory operations
- Performance: < 5ms latency для Redis operations
- Zero-downtime deployments support

**Business Metrics**

- Weekly downloads > 1K для core package
- GitHub stars > 500
- Production usage в > 10 компаниях
- Community contributions > 20%

## Лицензия

MIT License
