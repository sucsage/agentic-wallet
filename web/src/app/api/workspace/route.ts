import { contractApiStub } from "@/lib/api-stub";

/** Workspace creation will be wired to the wallet factory in a later milestone. */
export async function POST() {
  return contractApiStub();
}

export async function GET() {
  return contractApiStub();
}
