"use client";

import { LangToggle, type Key, useT } from "@/lib/i18n";

import { LaunchButton } from "./launch-button";

const STEPS: [Key, Key][] = [
  ["landing.step1", "landing.step1.d"],
  ["landing.step2", "landing.step2.d"],
  ["landing.step3", "landing.step3.d"],
  ["landing.step4", "landing.step4.d"],
];

const TIERS: { n: number; name: Key; body: Key; tone: string }[] = [
  { n: 0, name: "tier.0", body: "tier.0.d", tone: "bg-info-soft text-info" },
  { n: 1, name: "tier.1", body: "tier.1.d", tone: "bg-warn-soft text-warn" },
  { n: 2, name: "tier.2", body: "tier.2.d", tone: "bg-ok-soft text-ok" },
  { n: 3, name: "tier.3", body: "tier.3.d", tone: "bg-bad-soft text-bad" },
];

const GUARDS: [Key, Key, string][] = [
  ["landing.guard.agent", "landing.guard.agent.d", "bg-info-soft text-info"],
  ["landing.guard.policy", "landing.guard.policy.d", "bg-warn-soft text-warn"],
  ["landing.guard.contract", "landing.guard.contract.d", "bg-ok-soft text-ok"],
  ["landing.guard.escrow", "landing.guard.escrow.d", "bg-surface-2 text-fg"],
];

export function Landing() {
  const { t } = useT();
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-10 sm:px-6 sm:py-16">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg">AW</span>
          Agentic Wallet
        </div>
        <div className="flex items-center gap-2">
          <span className="pill hidden bg-surface-2 text-muted md:inline-flex">{t("landing.badge")}</span>
          <LangToggle />
        </div>
      </header>

      <section className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div className="flex flex-col gap-6">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("landing.title.a")} <span className="text-accent">{t("landing.title.b")}</span>
          </h1>
          <p className="max-w-xl text-lg text-muted">{t("landing.lead")}</p>
          <LaunchButton />
        </div>
        <div className="card p-5 text-sm">
          <p className="mb-3 font-medium">{t("landing.guards")}</p>
          <ol className="flex flex-col gap-2">
            {GUARDS.map(([title, desc, tone], i) => (
              <li key={title} className="flex flex-col">
                <div className={`rounded-lg px-3 py-2 ${tone}`}>
                  <div className="font-medium">{t(title)}</div>
                  <div className="text-xs opacity-80">{t(desc)}</div>
                </div>
                {i < GUARDS.length - 1 && <div className="mx-auto h-3 w-px bg-border" />}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("landing.how")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], i) => (
            <div key={title} className="card flex flex-col gap-2 p-5">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                {i + 1}
              </span>
              <h3 className="font-medium">{t(title)}</h3>
              <p className="text-sm text-muted">{t(body)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold">{t("landing.tiers")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <div key={tier.n} className="card flex flex-col gap-2 p-5">
              <span className={`pill w-fit ${tier.tone}`}>
                Tier {tier.n} · {t(tier.name)}
              </span>
              <p className="text-sm text-muted">{t(tier.body)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card flex flex-col gap-3 p-6">
        <h2 className="text-xl font-semibold">{t("landing.attack")}</h2>
        <p className="text-sm text-muted">
          {t("landing.attack.d1")} <em>{t("landing.attack.quote")}</em> {t("landing.attack.d2")}{" "}
          <code className="rounded bg-surface-2 px-1 font-mono text-xs">RecipientNotAllowed</code>
          {t("landing.attack.d3")}
        </p>
      </section>

      <footer className="border-t border-border pt-6 text-xs text-muted">{t("landing.footer")}</footer>
    </main>
  );
}
