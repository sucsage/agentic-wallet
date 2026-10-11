import { contractApiStub } from "@/lib/api-stub";

/** Wallet reads remain stubbed until contract integration is enabled. */
export async function GET() {
  return contractApiStub();
}
