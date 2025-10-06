import {
  TokenRegistryService,
  DefaultTokenValidator,
  DEFAULT_CONFIG,
  TokenData,
} from "@kavabanga/token-registry-core";
import { IoredisStore, createIoredisStore } from "../src";
import Redis from "ioredis";

// ===================== REDIS USAGE EXAMPLE =====================

async function redisUsageExample() {
  console.log("🚀 Token Registry - Redis Usage Example\n");

  // 1. Create Redis connection
  const redis = new Redis({
    host: "localhost",
    port: 6379,
    // password: "your-password", // if needed
    // db: 0, // default database
  });

  // 2. Create Redis store
  const store = createIoredisStore(redis, {
    keyPrefix: "refresh-tokens", // custom prefix
  });

  // 3. Create service
  const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
  const tokenRegistry = new TokenRegistryService(
    store,
    DEFAULT_CONFIG,
    validator
  );

  // 4. Save a token
  const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.token";
  const tokenData = {
    sub: "user123",
    issuedAt: Date.now(),
    meta: {
      deviceId: "device456",
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  };

  console.log("📝 Saving token to Redis...");
  await tokenRegistry.saveToken(token, tokenData);

  // 5. Retrieve token data
  console.log("\n🔍 Retrieving token data from Redis...");
  const retrievedData = await tokenRegistry.getTokenData(token);

  if (retrievedData) {
    console.log("✅ Token found in Redis:", {
      user: retrievedData.sub,
      device: retrievedData.meta.deviceId,
      ip: retrievedData.meta.ipAddress,
      expires: new Date(retrievedData.expiresAt).toISOString(),
    });
  } else {
    console.log("❌ Token not found in Redis");
  }

  // 6. Check Redis health
  console.log("\n🏥 Checking Redis health...");
  const isHealthy = await tokenRegistry.getHealthStatus();
  console.log(
    `Redis health status: ${isHealthy ? "✅ Healthy" : "❌ Unhealthy"}`
  );

  // 9. Revoke token
  console.log("\n🗑️ Revoking token from Redis...");
  await tokenRegistry.revokeToken(token);

  // 10. Verify token is gone
  const revokedData = await tokenRegistry.getTokenData(token);
  console.log(
    `Token after revocation: ${revokedData ? "❌ Still exists" : "✅ Successfully revoked"}`
  );

  // 11. Cleanup
  await tokenRegistry.shutdown();
  await redis.quit();
  console.log("\n🎉 Redis example completed successfully!");
}

// ===================== REDIS CLUSTER EXAMPLE =====================

async function redisClusterExample() {
  console.log("\n🌐 Token Registry - Redis Cluster Example\n");

  // Create Redis cluster connection
  const cluster = new Redis.Cluster([
    { host: "localhost", port: 7000 },
    { host: "localhost", port: 7001 },
    { host: "localhost", port: 7002 },
  ]);

  // Create store with cluster
  const store = createIoredisStore(cluster, {
    keyPrefix: "cluster-tokens",
  });

  const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
  const tokenRegistry = new TokenRegistryService(
    store,
    DEFAULT_CONFIG,
    validator
  );

  // Test cluster operations
  const token = "cluster-token-123";
  const tokenData: TokenData = {
    sub: "cluster-user",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    meta: { deviceId: "cluster-device" },
  };

  console.log("📝 Saving token to Redis cluster...");
  await tokenRegistry.saveToken(token, tokenData);

  const retrieved = await tokenRegistry.getTokenData(token);
  console.log(
    `Token retrieved from cluster: ${retrieved ? "✅ Success" : "❌ Failed"}`
  );

  await tokenRegistry.revokeToken(token);
  await tokenRegistry.shutdown();
  await cluster.quit();

  console.log("🎉 Redis cluster example completed!");
}

// ===================== REDIS SENTINEL EXAMPLE =====================

async function redisSentinelExample() {
  console.log("\n🛡️ Token Registry - Redis Sentinel Example\n");

  // Create Redis sentinel connection
  const sentinel = new Redis({
    sentinels: [
      { host: "localhost", port: 26379 },
      { host: "localhost", port: 26380 },
      { host: "localhost", port: 26381 },
    ],
    name: "mymaster", // master name
  });

  // Create store with sentinel
  const store = createIoredisStore(sentinel, {
    keyPrefix: "sentinel-tokens",
  });

  const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
  const tokenRegistry = new TokenRegistryService(
    store,
    DEFAULT_CONFIG,
    validator
  );

  // Test sentinel operations
  const token = "sentinel-token-123";
  const tokenData: TokenData = {
    sub: "sentinel-user",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    meta: { deviceId: "sentinel-device" },
  };

  console.log("📝 Saving token via Redis sentinel...");
  await tokenRegistry.saveToken(token, tokenData);

  const retrieved = await tokenRegistry.getTokenData(token);
  console.log(
    `Token retrieved via sentinel: ${retrieved ? "✅ Success" : "❌ Failed"}`
  );

  await tokenRegistry.revokeToken(token);
  await tokenRegistry.shutdown();
  await sentinel.quit();

  console.log("🎉 Redis sentinel example completed!");
}

// ===================== ERROR HANDLING EXAMPLE =====================

async function errorHandlingExample() {
  console.log("\n🚨 Redis Error Handling Example\n");

  // Create Redis connection with invalid host
  const redis = new Redis({
    host: "invalid-host",
    port: 6379,
    maxRetriesPerRequest: 1,
  });

  const store = createIoredisStore(redis);
  const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
  const tokenRegistry = new TokenRegistryService(
    store,
    DEFAULT_CONFIG,
    validator
  );

  try {
    // This should fail due to connection error
    await tokenRegistry.getHealthStatus();
  } catch (error) {
    console.log("✅ Caught Redis connection error:", (error as Error).message);
  }

  try {
    // This should also fail
    await tokenRegistry.saveToken("test-token", {
      sub: "user123",
      issuedAt: Date.now(),
      meta: { deviceId: "device123" },
    });
  } catch (error) {
    console.log("✅ Caught Redis operation error:", (error as Error).message);
  }

  await redis.quit();
  console.log("🎉 Error handling example completed!");
}

// ===================== RUN EXAMPLES =====================

async function runExamples() {
  try {
    await redisUsageExample();
    // Uncomment to test cluster/sentinel (requires running instances)
    // await redisClusterExample();
    // await redisSentinelExample();
    await errorHandlingExample();
  } catch (error) {
    console.error("❌ Example failed:", error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples();
}
