import { applyD1Migrations, env } from "cloudflare:test";

// Each test file gets its own isolated D1; give it the schema before any test
// runs. Storage is reset between test files by the pool.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
