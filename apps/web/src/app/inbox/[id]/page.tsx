import { redirect } from "next/navigation";

/** Old gate URLs: decisions open in the inbox side pane. */
export default async function GateRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/inbox?item=${encodeURIComponent(id)}`);
}
