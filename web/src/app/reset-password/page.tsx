import type { Metadata } from "next";
import { MockupApp } from "@/components/mockup-app";

export const metadata: Metadata = {
  title: "Reset password · MilestonePay",
  description: "Choose a new password for your MilestonePay account.",
};

export default function ResetPasswordPage() {
  return <MockupApp initialRoute="reset-password" />;
}
