"use client";

import Link from "next/link";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { LangToggle, useT } from "@/lib/i18n";

type Provider = "google" | "apple";

export function LoginPanel({ providers }: { providers: Record<Provider, boolean> }) {
  const { t } = useT();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(provider: Provider) {
    setBusy(provider);
    setError(null);
    const { error } = await authClient.signIn.social({ provider, callbackURL: "/profile" });
    // On success the browser is already navigating to the provider.
    if (error) {
      setError(error.message ?? t("auth.error"));
      setBusy(null);
    }
  }

  const none = !providers.google && !providers.apple;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-muted hover:text-fg">
          ← {t("auth.back")}
        </Link>
        <LangToggle />
      </div>
      <div className="card flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{t("auth.title")}</h1>
          <p className="text-sm text-muted">{t("auth.lead")}</p>
        </div>
        {providers.google && (
          <button className="btn-ghost py-2.5" onClick={() => signIn("google")} disabled={busy !== null}>
            <GoogleIcon /> {t("auth.google")}
          </button>
        )}
        {providers.apple && (
          <button
            className="btn py-2.5 bg-black text-white hover:opacity-90 dark:bg-white dark:text-black"
            onClick={() => signIn("apple")}
            disabled={busy !== null}
          >
            <AppleIcon /> {t("auth.apple")}
          </button>
        )}
        {none && <p className="text-sm text-warn">{t("auth.none")}</p>}
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1c.9-2.8 3.5-4.9 6.6-4.9z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.8c0-.1-2.6-1-2.6-4.2zM13.9 5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" />
    </svg>
  );
}
