import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";

import { db } from "./db";
import { mockBank } from "./mock-bank-auth";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  // No Google / Apple: everyone signs in through the Mock Bank (src/lib/mock-bank-auth.ts).
  databaseHooks: {
    user: {
      create: {
        // Every user gets a Profile row, seeded from the bank customer's display name.
        after: async (user) => {
          const [firstName, ...rest] = user.name.trim().split(/\s+/);
          await db.profile.create({
            data: { userId: user.id, firstName: firstName || null, lastName: rest.join(" ") || null },
          });
        },
      },
    },
  },
  plugins: [mockBank(), nextCookies()],
});

/** The signed-in user's session, or null. Use in Server Components, actions and route handlers. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
