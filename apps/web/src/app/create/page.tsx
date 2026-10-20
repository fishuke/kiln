import type { Metadata } from "next";
import { listConnections } from "@/lib/api/factory-admin";
import { AUTOMATION_TEMPLATES } from "@/lib/factory-template";
import { api, safe } from "@/lib/kiln";
import { CreateWizard } from "./wizard";

export const metadata: Metadata = { title: "Create factory" };

export default async function CreateFactory() {
  const [connections, factories, remote] = await Promise.all([listConnections(), safe(() => api.factories(), []), safe(() => api.automationTemplates(), [])]);
  // API templates name the connections they need; the first one is the icon.
  const templates = remote.length
    ? remote.map((t) => ({ id: t.id, name: t.title, description: t.description, provider: t.requires[0] ?? "schedule", requires: t.requires }))
    : AUTOMATION_TEMPLATES.map(({ id, name, description, provider, requires }) => ({ id, name, description, provider, requires }));
  return <CreateWizard connections={connections} takenAliases={factories.map((f) => f.alias)} templates={templates} />;
}
