import {
  TokenRegistryService,
  InMemoryStore,
  DefaultTokenValidator,
  DEFAULT_CONFIG,
  TokenEventHandler,
  TokenData,
} from "../src";

// ===================== BASIC USAGE EXAMPLE =====================

async function basicUsage() {
  console.log("🚀 Token Registry - Basic Usage Example\n");

  // 1. Create store and validator
  const store = new InMemoryStore();
  const validator = new DefaultTokenValidator(DEFAULT_CONFIG);

  // 2. Create service
  const tokenRegistry = new TokenRegistryService(
    store,
    DEFAULT_CONFIG,
    validator
  );

  // 3. Create audit handler
  const auditHandler: TokenEventHandler = {
    async onTokenCreated(token: string, data: TokenData): Promise<void> {
      console.log(
        `✅ Token created: ${token.substring(0, 8)}... for user: ${data.sub}`
      );
    },

    async onTokenAccessed(token: string, data: TokenData): Promise<void> {
      console.log(
        `👁️  Token accessed: ${token.substring(0, 8)}... for user: ${data.sub}`
      );
    },

    async onTokenRevoked(token: string, data: TokenData): Promise<void> {
      console.log(
        `🗑️  Token revoked: ${token.substring(0, 8)}... for user: ${data.sub}`
      );
    },
  };

  // 4. Register event handler
  tokenRegistry.registerEventHandler(auditHandler);

  // 5. Save a token
  const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example.token";
  const tokenData: TokenData = {
    sub: "user123",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    meta: {
      deviceId: "device456",
      ipAddress: "192.168.1.1",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  };

  console.log("📝 Saving token...");
  await tokenRegistry.saveToken(token, tokenData);

  // 6. Retrieve token data
  console.log("\n🔍 Retrieving token data...");
  const retrievedData = await tokenRegistry.getTokenData(token);

  if (retrievedData) {
    console.log("✅ Token found:", {
      user: retrievedData.sub,
      device: retrievedData.meta.deviceId,
      ip: retrievedData.meta.ipAddress,
      expires: new Date(retrievedData.expiresAt).toISOString(),
    });
  } else {
    console.log("❌ Token not found");
  }

  // 7. Check health
  console.log("\n🏥 Checking service health...");
  const isHealthy = await tokenRegistry.getHealthStatus();
  console.log(`Health status: ${isHealthy ? "✅ Healthy" : "❌ Unhealthy"}`);

  // 8. Revoke token
  console.log("\n🗑️ Revoking token...");
  await tokenRegistry.revokeToken(token);

  // 9. Verify token is gone
  const revokedData = await tokenRegistry.getTokenData(token);
  console.log(
    `Token after revocation: ${revokedData ? "❌ Still exists" : "✅ Successfully revoked"}`
  );

  // 10. Cleanup
  await tokenRegistry.shutdown();
  console.log("\n🎉 Example completed successfully!");
}

// ===================== ERROR HANDLING EXAMPLE =====================

async function errorHandlingExample() {
  console.log("\n🚨 Error Handling Example\n");

  const store = new InMemoryStore();
  const validator = new DefaultTokenValidator(DEFAULT_CONFIG);
  const tokenRegistry = new TokenRegistryService(
    store,
    DEFAULT_CONFIG,
    validator
  );

  try {
    // Try to save invalid token data
    await tokenRegistry.saveToken("", {
      sub: "",
      issuedAt: 0,
      expiresAt: 0,
      meta: {},
    });
  } catch (error) {
    console.log("✅ Caught validation error:", (error as Error).message);
  }

  try {
    // Try to get non-existent token
    await tokenRegistry.getTokenData("non-existent-token");
  } catch (error) {
    console.log("✅ Caught not found error:", (error as Error).message);
  }

  try {
    // Try to revoke non-existent token
    await tokenRegistry.revokeToken("non-existent-token");
  } catch (error) {
    console.log("✅ Caught not found error:", (error as Error).message);
  }

  await tokenRegistry.shutdown();
}

// ===================== CUSTOM VALIDATOR EXAMPLE =====================

import { ITokenValidator, TokenValidationError } from "../src";

class CustomValidator implements ITokenValidator {
  async validate(token: string, data: TokenData, ttl: number): Promise<void> {
    // Custom business rules
    if (data.sub === "admin" && ttl > 24 * 60 * 60) {
      // 1 day
      throw new TokenValidationError("Admin tokens cannot have TTL > 1 day");
    }

    if (data.meta.ipAddress === "127.0.0.1") {
      throw new TokenValidationError("Localhost IP not allowed");
    }
  }
}

async function customValidatorExample() {
  console.log("\n🔧 Custom Validator Example\n");

  const store = new InMemoryStore();
  const validator = new CustomValidator();
  const tokenRegistry = new TokenRegistryService(
    store,
    DEFAULT_CONFIG,
    validator
  );

  try {
    // This should fail due to localhost IP
    await tokenRegistry.saveToken("admin-token", {
      sub: "admin",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      meta: {
        ipAddress: "127.0.0.1",
        deviceId: "admin-device",
      },
    });
  } catch (error) {
    console.log(
      "✅ Custom validation caught localhost IP:",
      (error as Error).message
    );
  }

  try {
    // This should fail due to admin TTL
    await tokenRegistry.saveToken("admin-token", {
      sub: "admin",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
      meta: {
        ipAddress: "192.168.1.1",
        deviceId: "admin-device",
      },
    });
  } catch (error) {
    console.log(
      "✅ Custom validation caught admin TTL:",
      (error as Error).message
    );
  }

  // This should work
  await tokenRegistry.saveToken("user-token", {
    sub: "user123",
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600000,
    meta: {
      ipAddress: "192.168.1.1",
      deviceId: "user-device",
    },
  });
  console.log("✅ Valid token saved successfully");

  await tokenRegistry.shutdown();
}

// ===================== RUN EXAMPLES =====================

async function runExamples() {
  try {
    await basicUsage();
    await errorHandlingExample();
    await customValidatorExample();
  } catch (error) {
    console.error("❌ Example failed:", error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples();
}
