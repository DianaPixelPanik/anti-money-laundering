// tests/global-setup.ts — runs once before all test suites
import { config } from "dotenv";
import { resolve } from "path";
import { execSync } from "child_process";

export async function setup() {
  // Load test env before anything else
  config({ path: resolve(__dirname, "../.env.test") });

  // Push Prisma schema to the test database
  console.log("\n[test:setup] Pushing Prisma schema to test DB...");
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: resolve(__dirname, "../../../packages/db"),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
  });
  console.log("[test:setup] Schema ready.\n");
}

export async function teardown() {
  // nothing — containers managed externally via docker-compose --profile test
}
