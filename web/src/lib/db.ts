import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// One client per server process; dev hot reload would otherwise open a new pool on every edit.
const g = globalThis as unknown as { prisma?: PrismaClient };

// DB_SCHEMA keeps each chain's app data apart in one database (e.g. "besu" for the private chain),
// so wallets, bank accounts and drafts never point at contracts on another chain.
const schema = process.env.DB_SCHEMA || undefined;

export const db =
  g.prisma ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined) });

if (process.env.NODE_ENV !== "production") g.prisma = db;
