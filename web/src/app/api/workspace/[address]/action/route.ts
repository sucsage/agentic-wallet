import { contractApiStub } from "@/lib/api-stub";

/** Approvals, escrow actions, and wallet controls are intentionally offline. */
export async function POST() {
  return contractApiStub();
}
