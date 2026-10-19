import type { Metadata } from "next";
import { MockupApp } from "@/components/mockup-app";

export const metadata: Metadata = {
  title: "Reset password · Kravii",
  description: "Choose a new password for your Kravii account.",
};

export default function ResetPasswordPage() {
  return <MockupApp initialRoute="reset-password" />;
}
