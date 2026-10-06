import { Workspace } from "@/components/workspace";

export default async function WorkspacePage({ params }: PageProps<"/w/[address]">) {
  const { address } = await params;
  return <Workspace address={address} />;
}
