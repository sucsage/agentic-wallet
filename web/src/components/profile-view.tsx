"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";

import { saveProfile } from "@/app/profile/actions";
import { authClient } from "@/lib/auth-client";
import { type Key, LangToggle, setLang, useT } from "@/lib/i18n";

type Props = {
  user: { name: string; email: string; image: string | null };
  profile: {
    firstName: string;
    lastName: string;
    phone: string;
    dateOfBirth: string;
    organization: string;
    jobTitle: string;
    country: string;
    locale: "en" | "th";
  };
  providers: string[];
  wallets: { address: string; role: string; createdAt: string; openProposals: number }[];
};

const FIELDS: { name: keyof Props["profile"]; label: Key; type?: string; auto?: string }[] = [
  { name: "firstName", label: "profile.firstName", auto: "given-name" },
  { name: "lastName", label: "profile.lastName", auto: "family-name" },
  { name: "phone", label: "profile.phone", type: "tel", auto: "tel" },
  { name: "dateOfBirth", label: "profile.dob", type: "date", auto: "bday" },
  { name: "organization", label: "profile.org", auto: "organization" },
  { name: "jobTitle", label: "profile.jobTitle", auto: "organization-title" },
  { name: "country", label: "profile.country", auto: "country" },
];

const input = "rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

export function ProfileView({ user, profile, providers, wallets }: Props) {
  const { t } = useT();
  const router = useRouter();
  const [state, action, pending] = useActionState(saveProfile, null);

  async function signOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="text-sm text-muted hover:text-fg">
          ← {t("auth.back")}
        </Link>
        <div className="flex items-center gap-2">
          <LangToggle />
          <button className="btn-ghost text-xs" onClick={signOut}>
            {t("auth.signOut")}
          </button>
        </div>
      </header>

      <div className="flex items-center gap-4">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- provider avatar, any host
          <img src={user.image} alt="" className="h-14 w-14 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="grid h-14 w-14 place-items-center rounded-full bg-accent text-xl text-accent-fg">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{user.name}</h1>
          <p className="truncate text-sm text-muted">{user.email}</p>
          <div className="mt-1 flex gap-1.5">
            {providers.map((p) => (
              <span key={p} className="pill bg-surface-2 text-muted">
                {p === "apple" ? "Apple" : p === "google" ? "Google" : p}
              </span>
            ))}
          </div>
        </div>
      </div>

      <form action={action} className="card flex flex-col gap-4 p-5">
        <h2 className="font-semibold">{t("profile.basic")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.name} className="flex flex-col gap-1 text-sm">
              <span className="text-muted">{t(f.label)}</span>
              <input
                name={f.name}
                type={f.type ?? "text"}
                autoComplete={f.auto}
                defaultValue={profile[f.name]}
                maxLength={f.name === "country" ? 2 : 120}
                className={input}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">{t("profile.locale")}</span>
            <select
              name="locale"
              defaultValue={profile.locale}
              className={input}
              onChange={(e) => setLang(e.target.value as "en" | "th")}
            >
              <option value="en">English</option>
              <option value="th">ภาษาไทย</option>
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={pending}>
            {pending ? t("profile.saving") : t("profile.save")}
          </button>
          {state?.ok && !pending && <span className="text-sm text-ok">{t("profile.saved")}</span>}
          {state?.error && <span className="text-sm text-bad">{state.error}</span>}
        </div>
      </form>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="font-semibold">{t("profile.wallets")}</h2>
        {wallets.length === 0 ? (
          <p className="text-sm text-muted">{t("profile.noWallets")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {wallets.map((w) => (
              <li key={w.address} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{w.address}</p>
                  <p className="text-xs text-muted">
                    {w.role} · {new Date(w.createdAt).toLocaleString()}
                    {w.openProposals > 0 && ` · ${t("profile.openProposals", { n: w.openProposals })}`}
                  </p>
                </div>
                <a className="btn-ghost text-xs" href={`/w/${w.address}`}>
                  {t("profile.open")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
