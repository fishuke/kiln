import type { Metadata } from "next";
import { api, safe } from "@/lib/kiln";
import { SECRET_TYPES, type SecretTypeId } from "@/lib/secret-types";
import { SecretForm } from "../secret-form";

export const metadata: Metadata = { title: "New Secret" };

export default async function NewSecret({ searchParams }: { searchParams: Promise<{ scope?: string; type?: string }> }) {
  const sp = await searchParams;
  const me = await safe(() => api.me(), null);
  const canTeam = me?.role === "owner" || me?.role === "admin";
  const type = SECRET_TYPES.some((t) => t.id === sp.type) ? (sp.type as SecretTypeId) : undefined;
  const scope = sp.scope === "personal" || sp.scope === "team" ? sp.scope : undefined;
  return <SecretForm canTeam={canTeam} initialScope={scope} initialType={type} />;
}
