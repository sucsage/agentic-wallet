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

export type CompanyView = {
  id: string;
  name: string;
  maskedTaxId: string;
  currency: "THB" | "CNY";
  wallet: string;
  groupId: string;
  threshold: number;
  signers: number;
  members: number;
  role: "Admin" | "Signer" | "Member";
  accountNo: string | null;
  balance: string;
};

export type Me = {
  user: { id: string; name: string; username?: string };
  bank: { name: string; currency: "THB" | "CNY"; token: string; customerType: "PERSONAL" | "COMPANY"; consentedAt: string | null };
  accounts: AccountView[];
  wallets: { address: string; role: string; label: string | null; openProposals: number; createdAt: string }[];
  /** The company the user acts as ("Acting as"); its account and wallet are the ones above. */
  acting?: { companyId: string; name: string; groupId: string; threshold: number; maskedTaxId: string } | null;
  companies?: CompanyView[];
  /** Present until the wallet account is open: the KYC application's status. */
  onboarding?: { status: "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED"; note: string | null };
};

type Status = "loading" | "onboarding" | "creating-wallet" | "ready" | "signed-out" | "error";

type AppData = {
  status: Status;
  error: string | null;
  me: Me | null;
  wallet: WalletState | null;
  drafts: DraftView[];
  /** Sidebar counts: things waiting for the user's approval, incoming friend requests. */
  badges: { approvals: number; friends: number; groups: number };
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
  const [badges, setBadges] = useState({ approvals: 0, friends: 0, groups: 0 });
  const creating = useRef(false);

  const refresh = useCallback(async () => {
    try {
      let current = await api<Me>("/api/me");
      // No wallet account yet: the onboarding (KYC) screen takes over until it is approved.
      if (current.onboarding) {
        setMe(current);
        setStatus("onboarding");
        return;
      }
      if (current.wallets.length === 0 && !current.acting && !creating.current) {
        creating.current = true;
        setMe(current);
        setStatus("creating-wallet");
        try {
          await api("/api/workspace", { method: "POST" });
        } finally {
          // Allow "Retry setup" after a failure; on success the wallet now exists anyway.
          creating.current = false;
        }
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
        const [approvals, friends, invites] = await Promise.all([
          api<{ count: number }>("/api/approvals").catch(() => ({ count: 0 })),
          api<{ friends: { direction: string }[] }>("/api/friends").catch(() => ({ friends: [] })),
          api<{ invites: unknown[] }>("/api/groups/invites").catch(() => ({ invites: [] })),
        ]);
        setBadges({ approvals: approvals.count, friends: friends.friends.filter((f) => f.direction === "incoming").length, groups: invites.invites.length });
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

  return <Ctx.Provider value={{ status, error, me, wallet, drafts, badges, refresh }}>{children}</Ctx.Provider>;
}

export function useAppData(): AppData {
  const v = useContext(Ctx);
  if (!v) return { status: "signed-out", error: null, me: null, wallet: null, drafts: [], badges: { approvals: 0, friends: 0, groups: 0 }, refresh: async () => {} };
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
    .filter((m) => !["Released", "Refunded", "Split"].includes(m.status))
    .reduce((t, m) => t + Number(m.amount), 0);
}

/** Downloads an API file response (CSV, JSON export) without leaving the page. */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
}
