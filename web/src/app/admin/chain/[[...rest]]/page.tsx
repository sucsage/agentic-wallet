import { redirect } from "next/navigation";

/** The explorer used to be admin-only here; it is public at /explorer now. */
export default async function OldExplorerPage({ params }: { params: Promise<{ rest?: string[] }> }) {
  const { rest } = await params;
  redirect(`/explorer${rest?.length ? `/${rest.join("/")}` : ""}`);
}
