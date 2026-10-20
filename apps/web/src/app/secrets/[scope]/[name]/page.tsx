import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ApiDown } from "@/components/kiln/ui";
import { api, safe } from "@/lib/kiln";
import type { SecretTypeId } from "@/lib/secret-types";
import { SecretForm } from "../../secret-form";

export const metadata: Metadata = { title: "Edit Secret" };

export default async function EditSecret({ params }: { params: Promise<{ scope: string; name: string }> }) {
  const { scope, name } = await params;
  if (scope !== "team" && scope !== "personal") notFound();
  const [secrets, me] = await Promise.all([safe(() => api.managedSecrets(), null), safe(() => api.me(), null)]);
  if (!secrets) return <ApiDown />;
  const s = secrets.find((x) => x.scope === scope && x.name === decodeURIComponent(name));
  if (!s) notFound();
  const canTeam = me?.role === "owner" || me?.role === "admin";
  return <SecretForm canTeam={canTeam} existing={{ scope: s.scope, name: s.name, type: s.type as SecretTypeId, description: s.description, updatedAt: s.updatedAt, updatedBy: s.updatedBy }} />;
}
