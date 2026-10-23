import type { Metadata } from "next";
import { AppSettingsPage } from "@/components/studio/app-settings-page";
import { api, safe } from "@/lib/kiln";
import { fakeAppSettings } from "@/lib/studio/fake-settings";
import { studioFakeEnabled } from "@/lib/studio/flag";

export const metadata: Metadata = { title: "App settings" };

export default async function StudioAppSettings({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  if (studioFakeEnabled()) return <AppSettingsPage appId={app} settings={fakeAppSettings()} canEditPolicy />;
  const [settings, me, found, layers] = await Promise.all([
    safe(() => api.studioSettings({ app }), undefined),
    safe(() => api.me(), undefined),
    safe(() => api.studioApp(app), undefined),
    safe(() => api.variables("app", app), []),
  ]);
  const a = found?.app;
  const [team, project] = await Promise.all([
    a ? safe(() => api.variables("team", a.team), []) : Promise.resolve([]),
    a?.projectId ? safe(() => api.variables("project", a.projectId!), []) : Promise.resolve([]),
  ]);
  const admin = me?.role === "owner" || me?.role === "admin";
  return (
    <AppSettingsPage
      appId={app}
      settings={settings}
      canEditPolicy={admin}
      environments={{
        layers,
        inherited: [{ from: "team", layers: team }, ...(a?.projectId ? [{ from: "project", layers: project }] : [])],
        canEdit: admin || (Boolean(me?.subject) && me?.subject === a?.createdBy),
      }}
    />
  );
}
