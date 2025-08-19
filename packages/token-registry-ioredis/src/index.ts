// ===================== REDIS STORE EXPORTS =====================

export { IoredisStore } from "./ioredis.adapter";
export type { IoredisStoreOptions } from "./ioredis.adapter";

// ===================== FACTORY FUNCTIONS =====================

import { IoredisStore, IoredisStoreOptions } from "./ioredis.adapter";
import { Redis, Cluster } from "ioredis";

/**
 * Creates a new IoredisStore instance with default options
 */
export function createIoredisStore(
  redis: Redis | Cluster,
  options?: IoredisStoreOptions
): IoredisStore {
  return new IoredisStore(redis, options);
}

/**
 * Creates a new IoredisStore instance with custom key prefix
 */
export function createIoredisStoreWithPrefix(
  redis: Redis | Cluster,
  keyPrefix: string
): IoredisStore {
  return new IoredisStore(redis, { keyPrefix });
}
