import { contractApiStub } from "@/lib/api-stub";

/** Sample documents are embedded in the browser mockup; no server data source is active. */
export async function GET() {
  return contractApiStub();
}
