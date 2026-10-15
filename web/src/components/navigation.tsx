"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";

const NavigationContext = createContext<{ pending: boolean; push: (href: string) => void } | null>(null);
export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [navigation, setNavigation] = useState<{ from: string; to: string } | null>(null);
  // A committed route (including its native loading/error boundary) owns its UI.
  // Do not keep a global React transition pending on an older, superseded request.
  if (navigation && pathname !== navigation.from) setNavigation(null);
  const pending = navigation !== null && pathname === navigation.from;
  const push = (href: string) => {
    const target = new URL(href, window.location.href);
    if (!pending && target.href === window.location.href) return;
    if (target.pathname !== pathname) setNavigation({ from: pathname, to: target.pathname });
    else setNavigation(null);
    router.push(href);
  };
  return <NavigationContext.Provider value={{ pending, push }}>{children}</NavigationContext.Provider>;
}
export function useNavigationPending() { return useContext(NavigationContext)?.pending ?? false; }
export function useAppRouter() {
  const router = useRouter();
  const navigation = useContext(NavigationContext);
  return { ...router, push: navigation?.push ?? router.push };
}
export function AppLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const router = useAppRouter();
  return <Link {...props} onNavigate={event => {
    let cancelled = false;
    onNavigate?.({ preventDefault: () => { cancelled = true; event.preventDefault(); } });
    if (cancelled || typeof props.href !== "string" || props.href.startsWith("#")) return;
    event.preventDefault(); router.push(props.href);
  }} />;
}
