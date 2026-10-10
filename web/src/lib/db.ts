import "server-only";

import { PrismaClient } from "@prisma/client";

// Next.js dev hot-reload re-imports modules on every change; caching the client on `global`
// stops each reload from opening a fresh pool of connections against Neon.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
