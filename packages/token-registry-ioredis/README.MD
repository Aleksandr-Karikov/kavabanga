# Token Registry Redis Store

Redis store для Token Registry с использованием ioredis.

## Особенности

- ✅ **Простота** - простой API для работы с Redis
- ✅ **Производительность** - использует SCAN для эффективного поиска
- ✅ **Надежность** - поддержка Redis Cluster и Sentinel
- ✅ **Гибкость** - настраиваемый key prefix
- ✅ **Мониторинг** - встроенные методы для мониторинга

## Установка

```bash
npm install @kavabanga/token-registry-ioredis ioredis
```

## Быстрый старт

### Базовое использование

```typescript
import { TokenRegistryService, DefaultTokenValidator, DEFAULT_CONFIG } from '@kavabanga/token-registry-core';
import { IoredisStore, createIoredisStore } from '@kavabanga/token-registry-ioredis';
import Redis from 'ioredis';

// Создаем Redis соединение
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  // password: 'your-password', // если нужно
});

// Создаем Redis store
const store = createIoredisStore(redis, {
  keyPrefix: 'refresh-tokens', // кастомный префикс
});

// Создаем сервис
const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
const tokenRegistry = new TokenRegistryService(store, DEFAULT_CONFIG, validator);

// Сохраняем токен
await tokenRegistry.saveToken('token123', {
  sub: 'user123',
  issuedAt: Date.now(),
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 дней
  meta: {
    deviceId: 'device456',
    ipAddress: '192.168.1.1'
  }
});

// Получаем данные токена
const data = await tokenRegistry.getTokenData('token123');
console.log(data); // TokenData или null

// Удаляем токен
await tokenRegistry.revokeToken('token123');
```

### Redis Cluster

```typescript
import Redis from 'ioredis';

// Создаем Redis cluster соединение
const cluster = new Redis.Cluster([
  { host: 'localhost', port: 7000 },
  { host: 'localhost', port: 7001 },
  { host: 'localhost', port: 7002 },
]);

const store = createIoredisStore(cluster, {
  keyPrefix: 'cluster-tokens',
});

const tokenRegistry = new TokenRegistryService(store, DEFAULT_CONFIG, validator);
```

### Redis Sentinel

```typescript
import Redis from 'ioredis';

// Создаем Redis sentinel соединение
const sentinel = new Redis({
  sentinels: [
    { host: 'localhost', port: 26379 },
    { host: 'localhost', port: 26380 },
    { host: 'localhost', port: 26381 },
  ],
  name: 'mymaster', // имя master'а
});

const store = createIoredisStore(sentinel, {
  keyPrefix: 'sentinel-tokens',
});

const tokenRegistry = new TokenRegistryService(store, DEFAULT_CONFIG, validator);
```

## Дополнительные методы

### Поиск токенов пользователя

```typescript
// Получить все токены пользователя
const userTokens = await store.getUserTokens('user123');
console.log(`Найдено ${userTokens.length} токенов для пользователя`);

// Получить токены для конкретного устройства
const deviceTokens = await store.getUserDeviceTokens('user123', 'device456');
console.log(`Найдено ${deviceTokens.length} токенов для устройства`);
```

### Управление токенами

```typescript
// Отозвать все токены пользователя
const revokedCount = await store.revokeUserTokens('user123');
console.log(`Отозвано ${revokedCount} токенов`);

// Отозвать токены для конкретного устройства
const deviceRevokedCount = await store.revokeTokensByDevice('user123', 'device456');
console.log(`Отозвано ${deviceRevokedCount} токенов устройства`);
```

### Мониторинг

```typescript
// Получить количество активных токенов
const activeCount = await store.getActiveTokenCount();
console.log(`Активных токенов: ${activeCount}`);

// Очистить истекшие токены
const cleanedCount = await store.cleanupExpiredTokens();
console.log(`Очищено ${cleanedCount} истекших токенов`);
```

## API Reference

### IoredisStore

Основной класс для работы с Redis.

```typescript
class IoredisStore implements ITokenStore {
  constructor(redis: Redis, options?: IoredisStoreOptions)

  // Основные методы ITokenStore
  save(token: string, data: TokenData, ttl: number): Promise<void>
  get(token: string): Promise<TokenData | null>
  delete(token: string): Promise<void>
  health(): Promise<boolean>

  // Дополнительные методы
  getUserTokens(userId: string): Promise<Array<{ token: string; data: TokenData }>>
  revokeUserTokens(userId: string): Promise<number>
  revokeTokensByDevice(userId: string, deviceId: string): Promise<number>
  getUserDeviceTokens(userId: string, deviceId: string): Promise<Array<{ token: string; data: TokenData }>>
  getActiveTokenCount(): Promise<number>
  cleanupExpiredTokens(): Promise<number>
}
```

### IoredisStoreOptions

Опции для настройки Redis store.

```typescript
interface IoredisStoreOptions {
  /** Кастомный префикс для ключей токенов. По умолчанию: 'token' */
  keyPrefix?: string;
}
```

### Factory функции

```typescript
// Создать store с дефолтными опциями
function createIoredisStore(redis: Redis, options?: IoredisStoreOptions): IoredisStore

// Создать store с кастомным префиксом
function createIoredisStoreWithPrefix(redis: Redis, keyPrefix: string): IoredisStore
```

## Структура ключей

Redis store использует следующую структуру ключей:

```
token:refresh-token-123 -> JSON.stringify(TokenData)
```

Где:
- `token:` - префикс (настраивается)
- `refresh-token-123` - сам токен
- Значение - JSON сериализованные данные токена

## Производительность

### SCAN vs KEYS

Store использует `SCAN` вместо `KEYS` для поиска токенов пользователя, что обеспечивает:

- ✅ Неблокирующие операции
- ✅ Работу с большими наборами данных
- ✅ Стабильную производительность

### Pipeline операции

Для массовых операций используется Redis pipeline:

- ✅ Атомарность операций
- ✅ Снижение сетевых накладных расходов
- ✅ Повышение производительности

## Мониторинг и обслуживание

### Health Check

```typescript
const isHealthy = await store.health();
if (!isHealthy) {
  console.log('Redis недоступен');
}
```

### Очистка истекших токенов

```typescript
// Рекомендуется запускать периодически (например, раз в час)
const cleanedCount = await store.cleanupExpiredTokens();
console.log(`Очищено ${cleanedCount} истекших токенов`);
```

### Мониторинг количества токенов

```typescript
const activeCount = await store.getActiveTokenCount();
console.log(`Активных токенов: ${activeCount}`);
```

## Лучшие практики

### 1. Настройка соединения

```typescript
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});
```

### 2. Использование кастомного префикса

```typescript
const store = createIoredisStore(redis, {
  keyPrefix: 'myapp:tokens', // Избегаем конфликтов с другими приложениями
});
```

### 3. Обработка ошибок

```typescript
try {
  await tokenRegistry.saveToken(token, data);
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    console.log('Redis недоступен');
  } else {
    console.error('Ошибка сохранения токена:', error);
  }
}
```

### 4. Периодическая очистка

```typescript
// Запускать раз в час
setInterval(async () => {
  try {
    const cleaned = await store.cleanupExpiredTokens();
    if (cleaned > 0) {
      console.log(`Очищено ${cleaned} истекших токенов`);
    }
  } catch (error) {
    console.error('Ошибка очистки токенов:', error);
  }
}, 60 * 60 * 1000);
```

## Тестирование

```typescript
import { IoredisStore } from '@kavabanga/token-registry-ioredis';
import Redis from 'ioredis';

describe('IoredisStore', () => {
  let store: IoredisStore;
  let redis: Redis;

  beforeEach(async () => {
    redis = new Redis();
    store = new IoredisStore(redis);
  });

  afterEach(async () => {
    await redis.flushdb();
    await redis.quit();
  });

  it('should save and retrieve token', async () => {
    const token = 'test-token';
    const data = { sub: 'user123', issuedAt: Date.now(), expiresAt: Date.now() + 3600000, meta: {} };

    await store.save(token, data, 3600);
    const retrieved = await store.get(token);

    expect(retrieved).toEqual(data);
  });
});
```

## Лицензия

MIT License
