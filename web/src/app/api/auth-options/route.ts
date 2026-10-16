import { authOptions } from "@/lib/auth";

/** Which sign-in methods the login screen shows (only configured providers). */
export function GET() {
  return Response.json(authOptions);
}
