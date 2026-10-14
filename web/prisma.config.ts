import { defineConfig, env } from "prisma/config";

// Prisma CLI does not read .env.local on its own.
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Schema changes go over the direct (non-pooled) Neon connection.
    // DB_SCHEMA (e.g. "besu") pushes the schema into that Postgres schema instead of "public".
    url: process.env.DB_SCHEMA
      ? `${env("DIRECT_URL")}${env("DIRECT_URL").includes("?") ? "&" : "?"}schema=${process.env.DB_SCHEMA}`
      : env("DIRECT_URL"),
  },
});
