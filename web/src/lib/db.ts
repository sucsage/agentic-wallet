import "server-only";

import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// The database is far away (Neon us-east-2): a TCP handshake can take longer than Node's 250 ms
// per-address attempt when it tries IPv6 and IPv4 in turn, which fails every connection with
// ETIMEDOUT. Give each attempt 2 s.
setDefaultAutoSelectFamilyAttemptTimeout(2000);

// One client per server process; dev hot reload would otherwise open a new pool on every edit.
const g = globalThis as unknown as { prisma?: PrismaClient };

// DB_SCHEMA keeps each chain's app data apart in one database (e.g. "besu" for the private chain),
// so wallets, bank accounts and drafts never point at contracts on another chain.
const schema = process.env.DB_SCHEMA || undefined;

export const db =
  g.prisma ??
  new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined) });

if (process.env.NODE_ENV !== "production") g.prisma = db;
