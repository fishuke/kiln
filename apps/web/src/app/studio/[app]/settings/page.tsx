import type { Metadata } from "next";
import { AppSettingsPage } from "@/components/studio/app-settings-page";
import { api, safe } from "@/lib/kiln";
import { fakeAppSettings } from "@/lib/studio/fake-settings";
import { studioFakeEnabled } from "@/lib/studio/flag";

export const metadata: Metadata = { title: "App settings" };

export default async function StudioAppSettings({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  if (studioFakeEnabled()) return <AppSettingsPage appId={app} settings={fakeAppSettings()} canEditPolicy />;
  const [settings, me] = await Promise.all([safe(() => api.studioSettings({ app }), undefined), safe(() => api.me(), undefined)]);
  return <AppSettingsPage appId={app} settings={settings} canEditPolicy={me?.role === "owner" || me?.role === "admin"} />;
}
