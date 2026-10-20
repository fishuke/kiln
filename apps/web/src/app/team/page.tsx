import type { Metadata } from "next";
import { ApiDown, PageHeader } from "@/components/kiln/ui";
import { ActionRow, SettingsColumn, SettingsSection } from "@/components/kiln/settings-blocks";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, safe } from "@/lib/kiln";
import { DataStorage, HostAndRoles, LeaveTeam, ListSetting, ModelKeys, SpendLimit } from "./config";
import { CLAUDE_TOKEN_SECRET } from "./constants";
import { NewTeamButton } from "./new-team";
import { FactoryMembers, GeneralForm, Invites, MembersTable } from "./people";

export const metadata: Metadata = { title: "Team settings" };

const NAV = [
  { id: "general", label: "General" },
  { id: "members", label: "Members" },
  { id: "invites", label: "Invites" },
  { id: "factory-roles", label: "Factory roles" },
  { id: "model-keys", label: "Model keys" },
  { id: "spend-limit", label: "Spend limit" },
  { id: "github-orgs", label: "GitHub orgs" },
  { id: "defaults", label: "Team defaults" },
  { id: "egress", label: "Egress" },
  { id: "storage", label: "Data storage" },
  { id: "danger-zone", label: "Danger zone" },
];

const ROLE_TABLE = [
  ["User", "See the factory, send work, decide spec, preview and question gates, propose memories."],
  ["Editor", "Everything a User can, plus edit the definition, agents, repos and automations, attach secrets, MCP servers and runners, and confirm merges."],
  ["Admin", "Everything, including factory members and forcing a definition change that waits for a second approval."],
];

export default async function TeamSettingsPage() {
  const me = await safe(() => api.me(), null);
  if (!me) return <ApiDown />;
  const current = me.currentTeam;
  if (!current) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Team settings" }]} actions={<NewTeamButton />} />
        <SettingsColumn>
          <div className="rounded-xl border bg-muted/60 p-6 text-sm text-muted-foreground">This token does not act in a team. Log in with an account to manage teams.</div>
        </SettingsColumn>
      </>
    );
  }
  const id = current.id;
  const canEdit = me.role === "owner" || me.role === "admin";
  const [detail, members, invites, settings, modelKeys, secrets] = await Promise.all([
    safe(() => api.team(id), null),
    safe(() => api.teamMembers(id), []),
    canEdit ? safe(() => api.invites(id), []) : Promise.resolve([]),
    safe(() => api.teamSettings(id), null),
    canEdit ? safe(() => api.modelKeys(id) as Promise<Partial<Awaited<ReturnType<typeof api.modelKeys>>>>, {}) : Promise.resolve({}),
    safe(() => api.managedSecrets(), []),
  ]);
  if (!detail || !settings) return <ApiDown />;
  const factoryRows = await Promise.all(detail.factories.map(async (f) => ({ f, rows: await safe(() => api.factoryMembers(f.id), []) })));
  const claude = secrets.find((s) => s.scope === "team" && s.name === CLAUDE_TOKEN_SECRET);
  const myId = me.user?.id;
  const owners = members.filter((m) => m.role === "owner");
  const lastOwner = me.role === "owner" && owners.length <= 1;

  return (
    <>
      <PageHeader crumbs={[{ label: current.name }, { label: "Team settings" }]} actions={<NewTeamButton />} />
      <SettingsColumn nav={NAV}>
        <SettingsSection id="general" title="General">
          <GeneralForm team={{ id, name: detail.name, slug: detail.slug, avatar: detail.avatar, createdAt: detail.createdAt }} canEdit={canEdit} />
        </SettingsSection>

        <SettingsSection id="members" title={`Members (${members.length})`}>
          <MembersTable team={id} members={members} me={myId} myRole={me.role} />
        </SettingsSection>

        <SettingsSection id="invites" title="Invites">
          {canEdit ? <Invites team={id} invites={invites} canInvite={canEdit} isOwner={me.role === "owner"} /> : <p className="text-sm text-muted-foreground">Team owners and admins invite people.</p>}
        </SettingsSection>

        <SettingsSection id="factory-roles" title="Factory roles">
          <p className="mb-4 text-sm text-muted-foreground">Team owners and admins are Admin on every factory. Members get the default factory role (under Team defaults), or a higher role granted on a factory.</p>
          <div className="mb-5 overflow-hidden rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28 pl-4">Role</TableHead>
                  <TableHead>Can</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROLE_TABLE.map(([r, can]) => (
                  <TableRow key={r}>
                    <TableCell className="pl-4 align-top font-medium">{r}</TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">{can}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div>
            {factoryRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">This team has no factories yet.</p>
            ) : (
              factoryRows.map(({ f, rows }) => <FactoryMembers key={f.id} factory={f} rows={rows} members={members} canEdit={canEdit} />)
            )}
          </div>
        </SettingsSection>

        <SettingsSection id="model-keys" title="Model keys">
          {canEdit ? (
            <ModelKeys team={id} keys={modelKeys} claude={{ set: Boolean(claude), updatedAt: claude?.updatedAt, updatedBy: claude?.updatedBy }} canEdit={canEdit} />
          ) : (
            <p className="text-sm text-muted-foreground">Team owners and admins manage the team&apos;s model keys. You can add your own keys as personal secrets.</p>
          )}
        </SettingsSection>

        <SettingsSection id="spend-limit" title="Spend limit">
          <SpendLimit team={id} limit={settings.spendLimit} canEdit={canEdit} />
        </SettingsSection>

        <SettingsSection id="github-orgs" title="Enabled GitHub orgs">
          <ListSetting
            team={id}
            field="githubOrgs"
            initial={settings.githubOrgs}
            canEdit={canEdit}
            label="Organizations"
            description="When this list is not empty, the team's factories may only use repositories owned by these GitHub orgs or users."
            placeholder="Type an org and press Enter"
          />
        </SettingsSection>

        <SettingsSection id="defaults" title="Team defaults">
          <HostAndRoles team={id} settings={settings} canEdit={canEdit} />
        </SettingsSection>

        <SettingsSection id="egress" title="Egress allowlist">
          <ListSetting
            team={id}
            field="egressAllowlist"
            initial={settings.egressAllowlist}
            canEdit={canEdit}
            label="Allowed hosts"
            description="Added to every run's egress allowlist, on top of each factory's policy. Use *.example.com for subdomains."
            placeholder="registry.npmjs.org"
          />
        </SettingsSection>

        <SettingsSection id="storage" title="Data storage">
          <DataStorage team={id} storage={settings.storage} canEdit={canEdit} />
        </SettingsSection>

        <SettingsSection id="danger-zone" title="Danger zone">
          <ActionRow
            title="Leave team"
            description={lastOwner ? "You are the only owner. Make someone else an owner before you leave." : "You lose access to this team's factories, secrets and keys."}
          >
            {myId && <LeaveTeam team={id} me={myId} lastOwner={lastOwner} />}
          </ActionRow>
        </SettingsSection>
      </SettingsColumn>
    </>
  );
}
