"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAppRouter } from "./navigation";

/**
 * The header's notification bell and ⌘K search (Napat's v0.8 header, made to work): the bell
 * lists what waits for the user; search finds deals, contacts and groups by name.
 */

type Item = { text: string; href: string; tone?: "warn" | "info" };

async function get<T>(path: string): Promise<T | null> {
  const r = await fetch(path, { cache: "no-store" }).catch(() => null);
  return r && r.ok ? ((await r.json().catch(() => null)) as T) : null;
}

type Approvals = {
  drafts?: { title: string }[];
  reviews?: { dealId: number; title: string }[];
  offers?: { dealId: number; title: string; sellerLabel?: string }[];
  groupVotes?: { group: { name: string }; title: string }[];
  sellerTodo?: { dealId: number; title: string; step: string }[];
};

async function loadNotifications(): Promise<Item[]> {
  const [a, inv, fr] = await Promise.all([
    get<Approvals>("/api/approvals"),
    get<{ invites: { name: string; invitedBy: string }[] }>("/api/groups/invites"),
    get<{ friends: { name: string; direction: string }[] }>("/api/friends"),
  ]);
  const items: Item[] = [];
  for (const r of a?.reviews ?? []) items.push({ text: `Review the delivery for D-${r.dealId} · ${r.title}`, href: `/deals/D-${r.dealId}`, tone: "warn" });
  for (const o of a?.offers ?? []) items.push({ text: `Offer from ${o.sellerLabel || "a seller"}: ${o.title}`, href: `/deals/D-${o.dealId}`, tone: "warn" });
  for (const v of a?.groupVotes ?? []) items.push({ text: `${v.group.name} votes on: ${v.title}`, href: "/approvals", tone: "warn" });
  for (const t of a?.sellerTodo ?? []) items.push({ text: `${t.step === "accept" ? "Accept" : "Deliver"} D-${t.dealId} · ${t.title}`, href: `/deals/D-${t.dealId}` });
  for (const d of a?.drafts ?? []) items.push({ text: `Draft waiting for your approval: ${d.title}`, href: "/approvals" });
  for (const i of inv?.invites ?? []) items.push({ text: `${i.invitedBy} invited you to ${i.name}`, href: "/groups", tone: "info" });
  for (const f of (fr?.friends ?? []).filter((x) => x.direction === "incoming")) items.push({ text: `${f.name} wants to add you as a contact`, href: "/contacts", tone: "info" });
  return items;
}

export function NotificationsButton({ label }: { label: string }) {
  const router = useAppRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => void loadNotifications().then(setItems), []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      clearInterval(t);
      document.removeEventListener("mousedown", close);
    };
  }, [refresh]);
  return (
    <div className="aw-hdr-pop" ref={box}>
      <button
        className="aw-notification-button"
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          refresh();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {items && items.length > 0 && <span className="aw-hdr-dot">{items.length > 9 ? "9+" : items.length}</span>}
      </button>
      {open && (
        <div className="aw-hdr-menu" role="menu">
          <b>Notifications</b>
          {items === null && <small>Loading…</small>}
          {items?.length === 0 && <small>Nothing waits for you.</small>}
          {items?.map((i, k) => (
            <button
              type="button"
              role="menuitem"
              key={k}
              className={i.tone ?? ""}
              onClick={() => {
                setOpen(false);
                router.push(i.href);
              }}
            >
              {i.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Hit = { kind: "Deal" | "Contact" | "Group"; text: string; href: string };

async function loadIndex(): Promise<Hit[]> {
  const [d, f, g] = await Promise.all([
    get<{ deals: { id: number; title: string | null; counterpartyLabel: string }[]; drafts: { title: string }[] }>("/api/deals"),
    get<{ friends: { name: string; username: string; status: string }[] }>("/api/friends"),
    get<{ groups: { id: string; name: string }[] }>("/api/groups"),
  ]);
  return [
    ...(d?.deals ?? []).map((x) => ({ kind: "Deal" as const, text: `D-${x.id} · ${x.title ?? "Deal"} · ${x.counterpartyLabel}`, href: `/deals/D-${x.id}` })),
    ...(d?.drafts ?? []).map((x) => ({ kind: "Deal" as const, text: `Draft · ${x.title}`, href: "/approvals" })),
    ...(f?.friends ?? []).filter((x) => x.status === "ACCEPTED").map((x) => ({ kind: "Contact" as const, text: `${x.name} · @${x.username}`, href: "/contacts" })),
    ...(g?.groups ?? []).map((x) => ({ kind: "Group" as const, text: x.name, href: "/groups" })),
  ];
}

export function SearchBox({ placeholder }: { placeholder: string }) {
  const router = useAppRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const hits = q.trim().length < 1 ? [] : (index ?? []).filter((h) => h.text.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
  return (
    <div className="aw-hdr-pop aw-hdr-search">
      <label className="aw-navbar-search">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.7" cy="8.7" r="5.6" />
          <path d="m13 13 4 4" />
        </svg>
        <input
          ref={input}
          aria-label={placeholder}
          placeholder={placeholder}
          value={q}
          onFocus={() => {
            setOpen(true);
            if (!index) void loadIndex().then(setIndex);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits[0]) {
              router.push(hits[0].href);
              setQ("");
              input.current?.blur();
            }
            if (e.key === "Escape") input.current?.blur();
          }}
        />
        <kbd>⌘K</kbd>
      </label>
      {open && q.trim() && (
        <div className="aw-hdr-menu" role="listbox">
          {index === null && <small>Loading…</small>}
          {index && hits.length === 0 && <small>No deal, contact or group matches “{q.trim()}”.</small>}
          {hits.map((h, k) => (
            <button
              type="button"
              role="option"
              aria-selected={k === 0}
              key={k}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                router.push(h.href);
                setQ("");
                setOpen(false);
              }}
            >
              <small>{h.kind}</small> {h.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type MeLite = {
  user: { name: string };
  bank: { currency: "THB" | "CNY" };
  acting: { companyId: string; kind: "COMPANY" | "GROUP"; name: string } | null;
  companies?: { id: string; kind: "COMPANY" | "GROUP"; name: string; role: string; balance: string }[];
  accounts: { isDefault: boolean; balance: string }[];
};

const fmt = (minor: string, c: "THB" | "CNY") =>
  `${c === "THB" ? "฿" : "¥"}${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Which wallet the app works on: your own, or a company's / group's shared wallet you belong to.
 * Switching sets the "Acting as" cookie and reloads, so every page shows that wallet.
 */
export function WalletSwitcher() {
  const router = useAppRouter();
  const [me, setMe] = useState<MeLite | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void get<MeLite>("/api/me").then(setMe);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!me) return null;
  const current = me.acting?.companyId ?? null;
  const own = me.acting ? null : (me.accounts.find((a) => a.isDefault) ?? me.accounts[0]);
  const pick = async (id: string | null) => {
    if (id === current) return setOpen(false);
    setBusy(id ?? "me");
    const r = await fetch("/api/companies/acting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId: id }) }).catch(() => null);
    if (!r?.ok) return setBusy(null);
    // Every page reads the acting wallet from the server: reload so nothing shows the old one.
    window.location.reload();
  };
  const label = me.acting ? me.acting.name : `${me.user.name}`;
  const icon = (kind?: string) => (kind === "GROUP" ? "♧" : kind === "COMPANY" ? "♟" : "♙");
  return (
    <div className="aw-wallet-switch" ref={box}>
      <button type="button" className="aw-wallet-switch-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Switch wallet">
        <span aria-hidden>{icon(me.acting?.kind)}</span>
        <span className="aw-wallet-switch-name">{label}</span>
        <small>{me.acting ? (me.acting.kind === "GROUP" ? "Group" : "Company") : "Personal"}</small>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="aw-wallet-switch-menu" role="menu">
          <small>Switch wallet</small>
          <button type="button" role="menuitemradio" aria-checked={current === null} disabled={busy !== null} onClick={() => void pick(null)}>
            <span aria-hidden>♙</span>
            <span>
              <b>{me.user.name}</b>
              <small>Personal{own ? ` · ${fmt(own.balance, me.bank.currency)}` : ""}</small>
            </span>
            {current === null && <i>✓</i>}
            {busy === "me" && <i>…</i>}
          </button>
          {(me.companies ?? []).map((c) => (
            <button type="button" role="menuitemradio" aria-checked={current === c.id} key={c.id} disabled={busy !== null} onClick={() => void pick(c.id)}>
              <span aria-hidden>{icon(c.kind)}</span>
              <span>
                <b>{c.name}</b>
                <small>
                  {c.kind === "GROUP" ? "Group wallet" : "Company"} · {c.role} · {fmt(c.balance, me.bank.currency)}
                </small>
              </span>
              {current === c.id && <i>✓</i>}
              {busy === c.id && <i>…</i>}
            </button>
          ))}
          {(me.companies ?? []).length === 0 && <p>No shared wallets yet. A group&apos;s owner can open one, or register a company on Profile.</p>}
          <button
            type="button"
            className="aw-wallet-switch-more"
            onClick={() => {
              setOpen(false);
              router.push("/groups");
            }}
          >
            Manage groups →
          </button>
        </div>
      )}
    </div>
  );
}
