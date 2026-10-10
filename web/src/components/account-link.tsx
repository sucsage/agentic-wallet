"use client";

import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n";

/** Header link: "Sign in" when signed out, the user's avatar/name (to /profile) when signed in. */
export function AccountLink() {
  const { t } = useT();
  const { data, isPending } = authClient.useSession();
  if (isPending) return null;
  if (!data)
    return (
      <a className="btn-ghost text-xs" href="/login">
        {t("auth.signIn")}
      </a>
    );
  const { name, image } = data.user;
  return (
    <a className="btn-ghost text-xs" href="/profile">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- provider avatar, any host
        <img src={image} alt="" className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[10px] text-accent-fg">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="max-w-32 truncate">{name}</span>
    </a>
  );
}
