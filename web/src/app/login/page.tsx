import type { Metadata } from "next";
import { MockupApp } from "@/components/mockup-app";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Kravii with your bank.",
};

export default function LoginPage() {
  return <MockupApp initialRoute="login" />;
}
