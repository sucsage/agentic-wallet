import type { BetterAuthClientPlugin } from "better-auth/client";
import { createAuthClient } from "better-auth/react";

import type { mockBank } from "./mock-bank-auth";

/** Client side of the Mock Bank sign-in: authClient.mockBank.register / .login / .authorize. */
const mockBankClient = () =>
  ({
    id: "mock-bank",
    $InferServerPlugin: {} as ReturnType<typeof mockBank>,
    pathMethods: {
      "/mock-bank/register": "POST",
      "/mock-bank/login": "POST",
      "/mock-bank/authorize": "POST",
    },
    // authorize creates the session, so useSession() refreshes right after it.
    atomListeners: [{ matcher: (path) => path === "/mock-bank/authorize", signal: "$sessionSignal" }],
  }) satisfies BetterAuthClientPlugin;

export const authClient = createAuthClient({ plugins: [mockBankClient()] });
