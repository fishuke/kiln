"use client";

import type { StudioAppSettings, VariableLayerView } from "@kiln/sdk-ts";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { Environments, type InheritedLayers } from "@/components/kiln/environments";
import { SettingsColumn, SettingsSection } from "@/components/kiln/settings-blocks";
import { PageHeader } from "@/components/kiln/ui";
import { saveStudioSettings } from "@/components/studio-settings/actions";
import { APP_SETTINGS_NAV, AppSettingsView } from "@/components/studio-settings/app-settings";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShipMode, StudioApp } from "@/lib/studio/types";
import { DevCommand, MissingEnv } from "./setup-panel";
import { ShipModePicker } from "./top-bar";
import { useStudioClient } from "./use-client";

/**
 * /studio/[app]/settings: the App's ship mode, workspace and environments (its own variables over the
 * team's and its project's), then its definition (AppSettingsView,
 * the one source for agents, skills, policy and budget). Cowboy on an imported repository is the
 * person's opt-in, so confirming it also turns on the policy's `pushDefaultBranch`.
 */
export function AppSettingsPage({
  appId,
  settings,
  canEditPolicy,
  environments,
}: {
  appId: string;
  settings?: StudioAppSettings;
  canEditPolicy: boolean;
  environments?: { layers: VariableLayerView[]; inherited: InheritedLayers[]; canEdit: boolean };
}) {
  const client = useStudioClient();
  const [app, setApp] = useState<StudioApp>();
  const load = useCallback(
    () =>
      client?.app(appId).then(
        (d) => setApp(d.app),
        () => undefined,
      ),
    [client, appId],
  );
  useEffect(() => void load(), [load]);

  const setShipMode = async (mode: ShipMode) => {
    if (!client || !app) return;
    try {
      if (mode === "cowboy" && app.source.kind === "repo" && !settings?.resolved.policy.pushDefaultBranch) {
        const r = await saveStudioSettings({ app: appId }, { policy: { pushDefaultBranch: true } });
        if (!r.ok) throw new Error(r.error);
      }
      await client.setShipMode(appId, mode);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const nav = [
    { id: "ship-mode", label: "Ship mode" },
    ...(app?.setup ? [{ id: "workspace", label: "Workspace" }] : []),
    ...(environments ? [{ id: "environments", label: "Environments" }] : []),
    ...APP_SETTINGS_NAV,
  ];
  return (
    <>
      <PageHeader crumbs={[{ label: "Studio", href: "/studio" }, { label: app?.name ?? "App", href: `/studio/${appId}` }, { label: "Settings" }]} />
      <SettingsColumn nav={nav} title="Settings">
        <SettingsSection id="ship-mode" title="Ship mode">
          {app ? (
            <ShipModePicker value={app.shipMode} source={app.source} max={settings?.resolved.policy.maxShipMode} onChange={(m) => void setShipMode(m)} />
          ) : (
            <Skeleton className="h-48" />
          )}
        </SettingsSection>
        {app?.setup && (
          <SettingsSection id="workspace" title="Workspace">
            <div className="flex flex-col gap-4">
              <DevCommand
                app={app}
                onSave={async (devCommand) => {
                  await client?.updateApp(appId, { devCommand });
                  await load();
                }}
              />
              <MissingEnv appId={appId} keys={app.setup.envMissing} />
            </div>
          </SettingsSection>
        )}
        {environments && (
          <SettingsSection id="environments" title="Environments">
            <p className="mb-4 text-sm text-muted-foreground">
              Variables for this App only. They override the team&apos;s and the project&apos;s; a new chat or a preview restart picks them up.
            </p>
            <Environments scope="app" owner={appId} {...environments} onSaved={() => void load()} />
          </SettingsSection>
        )}
        {settings ? (
          <AppSettingsView scope={{ app: appId }} settings={settings} canEditPolicy={canEditPolicy} />
        ) : (
          <p className="text-sm text-muted-foreground">The App definition didn&apos;t load.</p>
        )}
      </SettingsColumn>
    </>
  );
}
