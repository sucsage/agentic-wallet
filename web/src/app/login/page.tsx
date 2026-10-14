import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/login-panel";
import { getSession } from "@/lib/auth";

export default async function LoginPage() {
  if (await getSession()) redirect("/profile");
  // Google / Apple are gone; the Mock Bank sign-in screen (authClient.mockBank.*) replaces this panel.
  return <LoginPanel providers={{ google: false, apple: false }} />;
}
