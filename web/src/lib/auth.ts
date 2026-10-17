import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { SignJWT, importPKCS8 } from "jose";
import { headers } from "next/headers";

import { db } from "./db";
import { emailEnabled, sendEmail } from "./email";
import { mockBank } from "./mock-bank-auth";

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

/** What the sign-in screen offers: only providers whose credentials are configured. */
export const authOptions = {
  google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  apple: Boolean(appleSecret),
  passwordReset: emailEnabled || process.env.NODE_ENV !== "production",
};

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  // Email and password, or Google / Apple; the wallet account opens after KYC (src/lib/onboarding.ts).
  // The Mock Bank sign-in (src/lib/mock-bank-auth.ts) stays only for the team's older test accounts.
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: 30 * 60,
    // A reset ends every other session: whoever knew the old password is signed out.
    revokeSessionsOnPasswordReset: true,
    // Only with a working mailer: otherwise the endpoint answers "not enabled" for every email alike.
    ...(authOptions.passwordReset && {
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: "Reset your MilestonePay password",
          text: `Hi ${user.name},\n\nSomeone asked to reset the password of your MilestonePay account. To choose a new one, open this link within 30 minutes:\n\n${url}\n\nIf it was not you, ignore this email: your password stays the same.`,
        });
      },
    }),
  },
  socialProviders: {
    ...(authOptions.google && {
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
    // Same verified email on Google, Apple and a password sign-up = one user, several sign-in methods.
    accountLinking: { enabled: true, trustedProviders: ["google", "apple"] },
  },
  // Apple returns to the callback with a cross-site form POST. Besides BETTER_AUTH_URL, this app's
  // other Vercel addresses (each deployment's own URL, branch URLs) may sign in, and in development
  // any localhost port.
  trustedOrigins: [
    "https://appleid.apple.com",
    ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((h) => `https://${h}`),
    "https://agentic-wallet-*-sucsages-projects.vercel.app",
    ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:*", "http://127.0.0.1:*"]),
  ],
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
