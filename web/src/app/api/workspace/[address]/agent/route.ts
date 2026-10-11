import { contractApiStub } from "@/lib/api-stub";

/** Agent actions are offline until their contract tools are implemented. */
export async function POST() {
  return contractApiStub();
}
