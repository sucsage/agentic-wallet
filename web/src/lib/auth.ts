import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { SignJWT, importPKCS8 } from "jose";
import { headers } from "next/headers";

import { db } from "./db";

/**
 * Sign in with Apple wants the client secret as an ES256 JWT signed with the .p8 key, valid for
 * at most 6 months. Minting it at boot means nobody has to rotate it by hand.
 */
async function appleClientSecret(): Promise<string | null> {
  const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = process.env;
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) return null;
  const key = await importPKCS8(APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"), "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: APPLE_KEY_ID })
    .setIssuer(APPLE_TEAM_ID)
    .setSubject(APPLE_CLIENT_ID)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("180d")
    .sign(key);
}

const appleSecret = await appleClientSecret();

/** Providers whose credentials are configured; the login page only shows these. */
export const enabledProviders = {
  google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  apple: Boolean(appleSecret),
};

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  socialProviders: {
    ...(enabledProviders.google && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        prompt: "select_account",
      },
    }),
    ...(appleSecret && {
      apple: {
        clientId: process.env.APPLE_CLIENT_ID!,
        clientSecret: appleSecret,
        // Native iOS app sign-in sends ID tokens whose audience is the bundle ID, not the Services ID.
        appBundleIdentifier: process.env.APPLE_APP_BUNDLE_ID,
      },
    }),
  },
  account: {
    // Same verified email on Google and Apple = one user with two sign-in methods.
    accountLinking: { enabled: true, trustedProviders: ["google", "apple"] },
  },
  // Apple returns to the callback with a cross-site form POST.
  trustedOrigins: ["https://appleid.apple.com"],
  databaseHooks: {
    user: {
      create: {
        // Every user gets a Profile row, seeded from what the provider told us.
        after: async (user) => {
          const [firstName, ...rest] = user.name.trim().split(/\s+/);
          await db.profile.create({
            data: { userId: user.id, firstName: firstName || null, lastName: rest.join(" ") || null },
          });
        },
      },
    },
  },
  plugins: [nextCookies()],
});

/** The signed-in user's session, or null. Use in Server Components, actions and route handlers. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
