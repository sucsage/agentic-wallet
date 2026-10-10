import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/login-panel";
import { enabledProviders, getSession } from "@/lib/auth";

export default async function LoginPage() {
  if (await getSession()) redirect("/profile");
  return <LoginPanel providers={enabledProviders} />;
}
