"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import type { DraftView } from "@/lib/bank/drafts";
import type { WalletState } from "@/lib/state";

/**
 * What the signed-in screens share: who the user is (/api/me), their agent wallet's state and
 * the agent's drafts. The first visit also creates the wallet, so a new tester lands in a working
 * chat without another step.
 */

export type AccountView = {
  id: string;
  accountNo: string;
  label: string;
  currency: "THB" | "CNY";
  balance: string;
  linked: boolean;
  isDefault: boolean;
};

export type Me = {
  user: { id: string; name: string };
  bank: { name: string; currency: "THB" | "CNY"; token: string; customerType: "PERSONAL" | "COMPANY"; consentedAt: string | null };
  accounts: AccountView[];
  wallets: { address: string; role: string; label: string | null; openProposals: number; createdAt: string }[];
};

type Status = "loading" | "creating-wallet" | "ready" | "signed-out" | "error";

type AppData = {
  status: Status;
  error: string | null;
  me: Me | null;
  wallet: WalletState | null;
  drafts: DraftView[];
  refresh: () => Promise<void>;
};

const Ctx = createContext<AppData | null>(null);

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.error ?? body?.message ?? `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export function AppDataProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [drafts, setDrafts] = useState<DraftView[]>([]);
  const creating = useRef(false);

  const refresh = useCallback(async () => {
    try {
      let current = await api<Me>("/api/me");
      if (current.wallets.length === 0 && !creating.current) {
        creating.current = true;
        setMe(current);
        setStatus("creating-wallet");
        await api("/api/workspace", { method: "POST" });
        current = await api<Me>("/api/me");
      }
      setMe(current);
      const address = current.wallets[0]?.address;
      if (address) {
        const [state, d] = await Promise.all([
          api<WalletState>(`/api/workspace/${address}`),
          api<{ drafts: DraftView[] }>(`/api/workspace/${address}/drafts`),
        ]);
        setWallet(state);
        setDrafts(d.drafts);
      }
      setError(null);
      setStatus("ready");
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 401 || e.status === 403) setStatus("signed-out");
      else {
        setError(e.message);
        setStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    // Fetching on mount is the point here: the screens need the signed-in user's data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return <Ctx.Provider value={{ status, error, me, wallet, drafts, refresh }}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) return { status: "signed-out", error: null, me: null, wallet: null, drafts: [], refresh: async () => {} };
  return v;
}

const SIGN: Record<"THB" | "CNY", string> = { THB: "฿", CNY: "¥" };

/** "5000000" minor units -> "฿50,000.00". */
export function money(minor: string | bigint, currency: "THB" | "CNY" = "THB"): string {
  const n = Number(minor) / 100;
  return `${SIGN[currency]}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2500.00" token units (already formatted by the server) -> "฿2,500.00". */
export function tokenMoney(amount: string | number, currency: "THB" | "CNY" | null | undefined): string {
  const n = Number(amount);
  const sign = currency ? SIGN[currency] : "";
  return `${sign}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? "" : " mUSDC"}`;
}

/** Money still locked in escrow for deals this wallet is buying. */
export function lockedInDeals(wallet: WalletState | null): number {
  if (!wallet) return 0;
  return wallet.fileDeals
    .filter((d) => d.role === "buyer" && d.status !== "Cancelled")
    .flatMap((d) => d.milestones)
    .filter((m) => !["Released", "Refunded"].includes(m.status))
    .reduce((t, m) => t + Number(m.amount), 0);
}
