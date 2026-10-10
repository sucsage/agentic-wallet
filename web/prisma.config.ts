import { defineConfig, env } from "prisma/config";

// Prisma CLI does not read .env.local on its own.
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Schema changes go over the direct (non-pooled) Neon connection.
    url: env("DIRECT_URL"),
  },
});
