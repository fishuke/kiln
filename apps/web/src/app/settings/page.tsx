import type { Metadata } from "next";
import Link from "next/link";
import { ApiDown, PageHeader } from "@/components/kiln/ui";
import { Field, SettingsColumn, SettingsSection } from "@/components/kiln/settings-blocks";
import { api, safe } from "@/lib/kiln";
import { ApiKeys, AppearancePicker, DigestForm, LinkedAccounts, NotificationHistory, NotificationsMatrix, PasswordForm, ProfileForm } from "./sections";

export const metadata: Metadata = { title: "Settings" };

const NAV = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "password", label: "Password" },
  { id: "notifications", label: "Notifications" },
  { id: "linked-accounts", label: "Linked accounts" },
  { id: "api-keys", label: "API keys" },
  { id: "networking", label: "Networking" },
];

export default async function UserSettings() {
  const me = await safe(() => api.me(), null);
  if (!me) return <ApiDown />;
  const team = me.currentTeam?.id;
  const [keys, settings, sent] = await Promise.all([
    safe(() => api.apiKeys(), []),
    team ? safe(() => api.teamSettings(team), null) : Promise.resolve(null),
    me.user ? safe(() => api.notifications(20), []) : Promise.resolve([]),
  ]);
  const user = me.user;
  const canTeamKeys = me.role === "owner" || me.role === "admin";
  return (
    <>
      <PageHeader crumbs={[{ label: "Settings" }]} />
      <SettingsColumn nav={user ? NAV : NAV.slice(5)}>
        {!user && (
          <div className="mb-10 rounded-xl border bg-muted/60 p-6 text-sm text-muted-foreground">
            You are using a {me.tokenType} token ({me.subject}), not a user account, so there is no profile to edit. <Link href="/logout" className="font-medium text-foreground underline-offset-4 hover:underline">Log in</Link> with an account to change your profile.
          </div>
        )}
        {user && (
          <>
            <SettingsSection id="profile" title="Profile">
              <ProfileForm name={user.name} email={user.email} avatar={user.avatar} />
            </SettingsSection>
            <SettingsSection id="appearance" title="Appearance">
              <Field label="Theme" description="Saved to your account and applied on every device where you have not picked one.">
                <AppearancePicker saved={user.appearance} />
              </Field>
            </SettingsSection>
            <SettingsSection id="password" title="Password">
              <PasswordForm hasPassword={user.hasPassword} />
            </SettingsSection>
            <SettingsSection id="notifications" title="Notifications">
              <Field label="Inbox notifications" description="Where Kiln tells you that something waits for you. The inbox in Kiln always shows everything.">
                <NotificationsMatrix prefs={user.notifications} />
              </Field>
              <Field label="Daily digest" description="A summary of open decisions once a day, by the channels you pick. Hours are in UTC.">
                <DigestForm digest={user.digest} />
              </Field>
              <Field label="Recently sent" description="What Kiln sent you, and whether it arrived. Email needs KILN_SMTP_URL on the server; Slack and Discord need a linked account.">
                <NotificationHistory items={sent} />
              </Field>
            </SettingsSection>
            <SettingsSection id="linked-accounts" title="Linked accounts">
              <p className="mb-3 text-sm text-muted-foreground">Linked accounts tell Kiln who you are when you mention a factory, reply in a thread or decide a gate from another tool.</p>
              <LinkedAccounts accounts={user.linkedAccounts} />
            </SettingsSection>
          </>
        )}
        <SettingsSection id="api-keys" title="API keys">
          <ApiKeys keys={keys} canTeamKeys={canTeamKeys} me={me.subject} />
        </SettingsSection>
        <SettingsSection id="networking" title="Networking">
          <Field
            label="Agent egress"
            description="Kiln runs agents in sandboxes on your own machines or cluster, so their traffic leaves from your network's addresses. Allow those addresses in firewalls of systems agents must reach."
          />
          <Field label="Egress allowlist" description="Hosts every run in this team may reach, on top of each factory's own policy." meta={canTeamKeys ? <Link href="/team#egress" className="font-medium text-foreground hover:underline">Edit in Team settings</Link> : undefined}>
            {settings?.egressAllowlist.length ? (
              <ul className="flex flex-wrap gap-2">
                {settings.egressAllowlist.map((h) => (
                  <li key={h} className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs">
                    {h}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No extra hosts.</p>
            )}
          </Field>
        </SettingsSection>
      </SettingsColumn>
    </>
  );
}
