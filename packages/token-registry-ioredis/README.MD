# Token Registry IoRedis Adapter

Redis adapter for the Token Registry system using IoRedis.

## Installation

```bash
npm install @kavabanga/token-registry-ioredis ioredis
```

## Basic Usage

```typescript
import { IoredisStoreAdapter } from '@kavabanga/token-registry-ioredis';
import { TokenRegistryService } from '@kavabanga/token-registry-core';
import Redis from 'ioredis';

// Create Redis connection
const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

// Create adapter
const adapter = new IoredisStoreAdapter(redis, {
  keyPrefix: 'myapp:tokens',
  useUserSets: true,
});

// Use with standard service
const service = new TokenRegistryService(adapter, config, validator);

// Basic operations work as expected
await service.saveToken('token123', tokenData);
const data = await service.getTokenData('token123');
```

## Extended Service Usage

For Redis-specific operations, use the extended service:

```typescript
import { 
  RedisTokenRegistryService, 
  RedisTokenRegistryServiceFactory 
} from '@kavabanga/token-registry-ioredis';

// Create extended service with Redis-specific methods
const redisService = RedisTokenRegistryServiceFactory.createDefault(
  adapter, 
  validator
);

// Now you have access to Redis-specific methods
const userTokens = await redisService.getUserTokens('user123');
const revokedCount = await redisService.revokeUserTokens('user123');
const deviceTokens = await redisService.getUserDeviceTokens('user123', 'device456');
const tokenCount = await redisService.getUserTokenCount('user123');

// Statistics and maintenance
const stats = await redisService.getTokenStats();
const cleanup = await redisService.cleanupUserSets();
const userSetsInfo = await redisService.getUserSetsInfo();

// Direct access to adapter if needed
const redisAdapter = redisService.getRedisAdapter();
```

## Available Redis-Specific Methods

### User Management
- `getUserTokens(userId)` - Get all tokens for a user
- `revokeUserTokens(userId)` - Revoke all tokens for a user
- `getUserTokenCount(userId)` - Get count of active tokens for a user

### Device Management
- `getUserDeviceTokens(userId, deviceId)` - Get tokens for specific user and device
- `revokeTokensByDevice(userId, deviceId)` - Revoke tokens for specific user and device

### Monitoring & Maintenance
- `getTokenStats()` - Get basic statistics about stored tokens
- `cleanupUserSets()` - Clean up stale user set references
- `getUserSetsInfo()` - Get information about user sets for monitoring

## Configuration Options

```typescript
interface IoredisAdapterOptions {
  /** Custom prefix for token keys. Default: 'token' */
  keyPrefix?: string;
  /** Whether to use user sets for efficient user token management. Default: true */
  useUserSets?: boolean;
}
```

## Architecture Benefits

This approach provides several architectural benefits:

1. **No Core Modification**: The core package remains unchanged
2. **Type Safety**: Full TypeScript support for Redis-specific methods
3. **Extensibility**: Each adapter can create its own extended service
4. **Backward Compatibility**: Standard service still works with all adapters
5. **Separation of Concerns**: Redis-specific logic stays in the Redis package

## Creating Custom Extended Services

You can create your own extended services for other adapters:

```typescript
import { TokenRegistryService } from '@kavabanga/token-registry-core';

export class MyCustomTokenRegistryService<T extends ITokenMeta = ITokenMeta> 
  extends TokenRegistryService<T> {
  
  private readonly customAdapter: MyCustomAdapter;

  constructor(adapter: MyCustomAdapter, config, validator) {
    super(adapter, config, validator);
    this.customAdapter = adapter;
  }

  // Add your custom methods here
  async myCustomMethod() {
    return await this.customAdapter.customOperation();
  }
}
```
