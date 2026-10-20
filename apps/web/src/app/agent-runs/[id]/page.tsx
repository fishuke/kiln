import { redirect } from "next/navigation";

/** Old agent run URLs: runs now live at /runs/<id>. */
export default async function AgentRunRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/runs/${id}`);
}
