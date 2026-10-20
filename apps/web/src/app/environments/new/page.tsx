import type { Metadata } from "next";
import { api, safe } from "@/lib/kiln";
import { EnvironmentForm } from "../environment-form";

export const metadata: Metadata = { title: "New Environment" };

export default async function NewEnvironment() {
  const [secrets, me] = await Promise.all([safe(() => api.managedSecrets(), []), safe(() => api.me(), null)]);
  const canEdit = me?.role === "owner" || me?.role === "admin";
  return <EnvironmentForm secrets={[...new Set(secrets.map((s) => s.name))].sort()} canEdit={canEdit} />;
}
