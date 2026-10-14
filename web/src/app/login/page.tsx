import type { Metadata } from "next";
import { MockupApp } from "@/components/mockup-app";

export const metadata: Metadata = {
  title: "Log in · MilestonePay",
  description: "Log in to MilestonePay with your bank.",
};

export default function LoginPage() {
  return <MockupApp initialRoute="login" />;
}
