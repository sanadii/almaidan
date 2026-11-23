import assert from "node:assert/strict";
import { test } from "node:test";
import { getGateway } from "../src/gateways";
import { assertLiveGatewayConfigured, assertLocalMockRuntime, loadRuntimeConfig } from "../src/runtime-config";

const production = {
  NODE_ENV: "production",
  FIREBASE_PROJECT_ID: "huroof-a3ee7",
  VITE_FIREBASE_PROJECT_ID: "huroof-a3ee7",
  ENTA_NAMESPACE_ID: "maydan-isolated-v1",
  DATABASE_URL: "postgresql://isolated.example/almaidan",
};

test("production fails closed when Firebase, PostgreSQL, or live payment config is missing", () => {
  assert.throws(() => loadRuntimeConfig({ NODE_ENV: "production", DATABASE_URL: production.DATABASE_URL, PAYMENT_PROVIDER: "tap", TAP_SECRET_KEY: "configured", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID }), /FIREBASE_PROJECT_ID/u);
  assert.throws(() => loadRuntimeConfig({ NODE_ENV: "production", FIREBASE_PROJECT_ID: production.FIREBASE_PROJECT_ID, VITE_FIREBASE_PROJECT_ID: production.VITE_FIREBASE_PROJECT_ID, PAYMENT_PROVIDER: "tap", TAP_SECRET_KEY: "configured", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID }), /DATABASE_URL/u);
  assert.throws(() => loadRuntimeConfig(production), /PAYMENT_PROVIDER/u);
  assert.throws(() => loadRuntimeConfig({ ...production, PAYMENT_PROVIDER: "tap" }), /Live tap configuration/u);
  assert.throws(() => loadRuntimeConfig({ ...production, PAYMENT_PROVIDER: "tap", TAP_SECRET_KEY: "configured", VITE_FIREBASE_PROJECT_ID: "other-project" }), /approved project/u);
  assert.doesNotThrow(() => loadRuntimeConfig({ ...production, PAYMENT_PROVIDER: "tap", TAP_SECRET_KEY: "configured" }));
  assert.throws(() => loadRuntimeConfig({ ...production, PAYMENT_PROVIDER: "tap", TAP_SECRET_KEY: "configured", FIREBASE_PROJECT_ID: "wrong", VITE_FIREBASE_PROJECT_ID: "wrong" }), /approved project/u);
  assert.throws(() => loadRuntimeConfig({ NODE_ENV: "production", FIREBASE_PROJECT_ID: production.FIREBASE_PROJECT_ID, VITE_FIREBASE_PROJECT_ID: production.VITE_FIREBASE_PROJECT_ID, DATABASE_URL: production.DATABASE_URL, PAYMENT_PROVIDER: "tap", TAP_SECRET_KEY: "configured" }), /ENTA_NAMESPACE_ID/u);
  assert.throws(() => assertLiveGatewayConfigured({ NODE_ENV: "production", PAYMENT_PROVIDER: "tap" }), /live payment gateway/u);
  assert.throws(() => getGateway({ NODE_ENV: "production", ENTA_ALLOW_DEV_MOCKS: "true", ENTA_RUNTIME_MODE: "local" }), /unhosted development\/test/u);
});

test("runtime config accepts only canonical PostgreSQL URLs for almaidan", () => {
  const databaseUrl = "postgresql://user:secret@db.example/almaidan?sslmode=require&schema=public&connection_limit=5&application_name=enta%0Aserver";
  const directUrl = "postgres://user:secret@direct.example/almaidan?sslmode=require";
  const config = loadRuntimeConfig({
    ...production,
    DATABASE_URL: ` ${databaseUrl} `,
    DIRECT_URL: directUrl,
    PAYMENT_PROVIDER: "tap",
    TAP_SECRET_KEY: "configured",
  });
  assert.equal(config.databaseUrl, databaseUrl);
  assert.equal(loadRuntimeConfig({
    NODE_ENV: "test", FIREBASE_PROJECT_ID: "new-project", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID,
  }).databaseUrl, undefined);
  assert.doesNotThrow(() => loadRuntimeConfig({
    NODE_ENV: "development", FIREBASE_PROJECT_ID: "new-project", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID,
    ENTA_RUNTIME_MODE: "local", ENTA_ALLOW_DEV_MOCKS: "true",
  }));
});

test("runtime config rejects invalid supplied URLs with fixed sanitized errors", () => {
  const invalidUrls = [
    "mysql://db.example/almaidan",
    "postgresql:///almaidan",
    "postgresql://db.example/other",
    "postgresql://db.example/other/../almaidan",
    "postgresql://db.example/%61lmaidan",
    "postgresql://db.example/almaidan%2fother",
    "postgresql://db.example/almaidan\\..\\other",
    "postgresql://db.example/almaidan%ZZ",
    "postgresql://user\u00a0name:secret@db.example/almaidan",
    "postgresql://user\u0085name:secret@db.example/almaidan",
    "postgresql://db.example/almaidan?application_name=enta\u2003server",
    "postgresql://db.example/almaidan?application_name=enta\u0091server",
    "postgresql://user%ZZname:secret@db.example/almaidan",
    "postgresql://user%name:secret@db.example/almaidan",
    "postgresql://db.example/almaidan?sslmode=%ZZ",
    "postgresql://db.example/almaidan?sslmode=%",
    "postgresql://db.example/almaidan#fragment",
    ...["dbname", "database", "host", "hostaddr", "port", "user", "password", "options", "service", "servicefile"]
      .map((key) => `postgresql://db.example/almaidan?${key.toUpperCase()}=override`),
    "postgresql://db.example/almaidan?%64atabase=other",
    "postgresql://db.example/almaidan\n?sslmode=require",
  ];
  for (const [key, expectedMessage] of [
    ["DATABASE_URL", "DATABASE_URL must be a valid PostgreSQL URL for the almaidan database"],
    ["DIRECT_URL", "DIRECT_URL must be a valid PostgreSQL URL for the almaidan database"],
  ] as const) {
    for (const url of invalidUrls) {
      assert.throws(() => loadRuntimeConfig({
        NODE_ENV: "test", FIREBASE_PROJECT_ID: "new-project", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID,
        [key]: url,
      }), (error: unknown) => error instanceof Error && error.message === expectedMessage);
    }
  }
  assert.throws(() => loadRuntimeConfig({
    NODE_ENV: "test", FIREBASE_PROJECT_ID: "new-project", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID,
    DIRECT_URL: "postgresql://db.example/other?password=never-log-this",
  }), (error: unknown) => error instanceof Error && error.message === "DIRECT_URL must be a valid PostgreSQL URL for the almaidan database");
  const secret = "synthetic-parser-secret";
  for (const [key, expectedMessage] of [
    ["DATABASE_URL", "DATABASE_URL must be a valid PostgreSQL URL for the almaidan database"],
    ["DIRECT_URL", "DIRECT_URL must be a valid PostgreSQL URL for the almaidan database"],
  ] as const) {
    assert.throws(() => loadRuntimeConfig({
      NODE_ENV: "test", FIREBASE_PROJECT_ID: "new-project", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID,
      [key]: `postgresql://user:${secret}@[not-ipv6/almaidan`,
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, expectedMessage);
      assert.equal(error.stack?.includes(secret), false);
      assert.equal(error.stack?.includes("not-ipv6"), false);
      assert.equal("cause" in error ? error.cause : undefined, undefined);
      return true;
    });
  }
  assert.throws(() => loadRuntimeConfig({
    NODE_ENV: "test", FIREBASE_PROJECT_ID: "new-project", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID,
    DIRECT_URL: "postgresql://db.example/almaidan?%68ost=override",
  }), (error: unknown) => error instanceof Error && error.message === "DIRECT_URL must be a valid PostgreSQL URL for the almaidan database");
  assert.throws(() => loadRuntimeConfig({
    NODE_ENV: "test", FIREBASE_PROJECT_ID: "new-project", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID,
    ENTA_RUNTIME_MODE: "local", ENTA_ALLOW_DEV_MOCKS: "true", DATABASE_URL: "postgresql://db.example/other",
  }), /DATABASE_URL must be a valid PostgreSQL URL for the almaidan database/u);
});

test("only an explicit non-production opt-in can select the isolated mock gateway", () => {
  assert.throws(() => getGateway({ NODE_ENV: "development" }), /live payment gateway/u);
  assert.equal(getGateway({ NODE_ENV: "development", ENTA_RUNTIME_MODE: "local", ENTA_ALLOW_DEV_MOCKS: "true" }).name, "mock");
  assert.throws(() => loadRuntimeConfig({ ...production, ENTA_ALLOW_DEV_MOCKS: "true", ENTA_RUNTIME_MODE: "local" }), /HOSTED_MOCK_OR_EMULATOR_FORBIDDEN/u);
  for (const marker of ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "AWS_LAMBDA_FUNCTION_NAME", "K_SERVICE", "WEBSITE_SITE_NAME"]) {
    assert.throws(() => assertLocalMockRuntime({
      NODE_ENV: "development", ENTA_RUNTIME_MODE: "local", ENTA_ALLOW_DEV_MOCKS: "true", [marker]: "preview",
    }), new RegExp("unhosted development/test", "u"), `${marker} prevents mock auth on hosted deployments`);
    assert.throws(() => getGateway({
      NODE_ENV: "development", ENTA_RUNTIME_MODE: "local", ENTA_ALLOW_DEV_MOCKS: "true", [marker]: "preview",
    }), /unhosted development\/test/u);
  }
  assert.throws(() => loadRuntimeConfig({ NODE_ENV: "development", FIREBASE_PROJECT_ID: "new-project", ENTA_NAMESPACE_ID: production.ENTA_NAMESPACE_ID, ENTA_ALLOW_DEV_MOCKS: "true" }), /unhosted development\/test/u);
});

test("a configured live gateway selects the explicit provider", () => {
  assert.equal(assertLiveGatewayConfigured({ ...production, PAYMENT_PROVIDER: "tap", TAP_SECRET_KEY: "present" }), "tap");
  assert.equal(getGateway({ ...production, PAYMENT_PROVIDER: "myfatoorah", MYFATOORAH_API_KEY: "present" }).name, "myfatoorah");
  assert.throws(() => assertLiveGatewayConfigured({ ...production, PAYMENT_PROVIDER: "unsupported", TAP_SECRET_KEY: "present" }), /live payment gateway/u);
});
