import "server-only";

import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import {
  BANK_CURRENCY,
  BANK_NAME,
  BankError,
  accountView,
  customerAccounts,
  linkAccounts,
  registerCustomer,
  verifyCustomer,
} from "./bank/customers";
import { db } from "./db";

/**
 * Better Auth plugin: sign in through the Mock Bank instead of Google or Apple.
 *
 *   POST /api/auth/mock-bank/register   open a demo customer (Thai or Chinese bank), get a ticket
 *   POST /api/auth/mock-bank/login      username + PIN at the bank, get a ticket + the passbooks
 *   POST /api/auth/mock-bank/authorize  ticket + the passbooks to link + consent -> app session
 *
 * The ticket plays the role of an open-banking authorization code: single use, 10 minutes, and
 * the only thing that carries the bank login over to the consent screen. Production path: the
 * bank's real OAuth / open-banking consent replaces register + login; authorize stays the same.
 */

const TICKET_PREFIX = "mock-bank-ticket:";
const TICKET_TTL_MS = 10 * 60 * 1000;

const bank = z.enum(["thai", "chinese"]);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,32}$/, "Username: 3-32 letters, digits, _ or .");
const pin = z.string().regex(/^\d{6}$/, "PIN: 6 digits");

function toApiError(err: unknown): never {
  if (err instanceof BankError) {
    const status = err.code === "LOCKED" ? "TOO_MANY_REQUESTS" : err.code === "USERNAME_TAKEN" ? "CONFLICT" : "UNAUTHORIZED";
    throw new APIError(err.code === "UNKNOWN_ACCOUNT" ? "BAD_REQUEST" : status, { code: err.code, message: err.message });
  }
  throw err;
}

export const mockBank = () =>
  ({
    id: "mock-bank",
    endpoints: {
      mockBankRegister: createAuthEndpoint(
        "/mock-bank/register",
        {
          method: "POST",
          body: z.object({
            bank,
            username,
            displayName: z.string().trim().min(1).max(80),
            pin,
            accountType: z.enum(["personal", "company"]).default("personal"),
          }),
        },
        async (ctx) => {
          const b = ctx.body;
          const currency = BANK_CURRENCY[b.bank];
          const { customer, accounts } = await registerCustomer({
            currency,
            username: b.username,
            displayName: b.displayName,
            pin: b.pin,
            type: b.accountType === "company" ? "COMPANY" : "PERSONAL",
          }).catch(toApiError);
          const ticket = await issueTicket(ctx, customer.id);
          return ctx.json({
            ticket,
            bank: { name: BANK_NAME[currency], currency },
            customer: { displayName: customer.displayName, type: customer.type },
            accounts: accounts.map(accountView),
          });
        },
      ),

      mockBankLogin: createAuthEndpoint(
        "/mock-bank/login",
        { method: "POST", body: z.object({ bank, username, pin }) },
        async (ctx) => {
          const currency = BANK_CURRENCY[ctx.body.bank];
          const customer = await verifyCustomer(currency, ctx.body.username, ctx.body.pin).catch(toApiError);
          const ticket = await issueTicket(ctx, customer.id);
          return ctx.json({
            ticket,
            bank: { name: BANK_NAME[currency], currency },
            customer: { displayName: customer.displayName, type: customer.type },
            accounts: (await customerAccounts(customer.id)).map(accountView),
          });
        },
      ),

      mockBankAuthorize: createAuthEndpoint(
        "/mock-bank/authorize",
        {
          method: "POST",
          body: z.object({
            ticket: z.string().min(16),
            accountIds: z.array(z.string()).min(1).max(10),
            defaultAccountId: z.string().optional(),
            // The consent screen's checkbox: the user lets the app see and debit these accounts.
            consent: z.literal(true),
          }),
        },
        async (ctx) => {
          const row = await ctx.context.internalAdapter.consumeVerificationValue(TICKET_PREFIX + ctx.body.ticket);
          if (!row || row.expiresAt < new Date()) {
            throw new APIError("UNAUTHORIZED", { code: "TICKET_EXPIRED", message: "Log in to the bank again" });
          }
          const customer = await db.bankCustomer.findUniqueOrThrow({ where: { id: row.value } });
          const accounts = await linkAccounts(customer.id, ctx.body.accountIds, ctx.body.defaultAccountId).catch(
            toApiError,
          );

          let user = customer.userId ? await ctx.context.internalAdapter.findUserById(customer.userId) : null;
          if (!user) {
            user = await ctx.context.internalAdapter.createUser({
              // Better Auth needs a unique email; bank customers have none. ".invalid" never delivers.
              email: `${customer.currency.toLowerCase()}.${customer.username}@mock-bank.invalid`,
              emailVerified: false,
              name: customer.displayName,
            }, { method: "mock-bank" });
            if (!user) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not create the user" });
            await db.bankCustomer.update({ where: { id: customer.id }, data: { userId: user.id } });
          }

          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not create a session" });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            user: { id: user.id, name: user.name },
            bank: { name: BANK_NAME[customer.currency], currency: customer.currency },
            accounts: accounts.filter((a) => a.linkedAt).map(accountView),
          });
        },
      ),
    },
    rateLimit: [
      // On top of the per-customer PIN lockout: slows down guessing across many usernames.
      { pathMatcher: (path: string) => path.startsWith("/mock-bank/"), window: 60, max: 10 },
    ],
  }) satisfies import("better-auth").BetterAuthPlugin;

async function issueTicket(
  ctx: { context: { internalAdapter: { createVerificationValue: (d: { identifier: string; value: string; expiresAt: Date }) => Promise<unknown> } } },
  customerId: string,
): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const ticket = Buffer.from(bytes).toString("base64url");
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: TICKET_PREFIX + ticket,
    value: customerId,
    expiresAt: new Date(Date.now() + TICKET_TTL_MS),
  });
  return ticket;
}
