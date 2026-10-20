import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, safe } from "@/lib/kiln";
import { EnvironmentForm } from "../environment-form";

export const metadata: Metadata = { title: "Environment" };

export default async function EditEnvironment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [env, secrets, me] = await Promise.all([safe(() => api.environment(id), null), safe(() => api.managedSecrets(), []), safe(() => api.me(), null)]);
  if (!env) notFound();
  const canEdit = me?.role === "owner" || me?.role === "admin";
  return <EnvironmentForm env={env} secrets={[...new Set(secrets.map((s) => s.name))].sort()} canEdit={canEdit} />;
}
