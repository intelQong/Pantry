import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath } from "node:url";
import { generateVAPIDKeys } from "web-push-neo";

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Migrations are read at config time and handed to the test setup file, which
// applies them to the isolated D1 instance the pool provides.
const migrations = await readD1Migrations(dir("./migrations"));

// A fixed VAPID keypair so push tests can exercise the real generateRequestDetails
// signing path without needing production secrets.
const vapidKeys = await generateVAPIDKeys();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          SESSION_SECRET: "test-secret-not-used-in-production",
          VAPID_PUBLIC_KEY: vapidKeys.publicKey,
          VAPID_PRIVATE_KEY: vapidKeys.privateKey,
          VAPID_SUBJECT: "mailto:mahmudulhk13@gmail.com",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    alias: {
      "@shared": dir("./src/shared"),
      "@worker": dir("./src/worker"),
    },
  },
});
