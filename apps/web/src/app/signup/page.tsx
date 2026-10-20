import type { Metadata } from "next";
import { AuthLink, AuthShell, CredentialsForm, GitHubButton, OrDivider } from "@/components/kiln/auth-shell";
import { api, safe } from "@/lib/kiln";
import { safeNext } from "@/lib/session";
import { githubLogin, signup } from "../login/actions";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; invite?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const anon = api.withToken("");
  const [providers, invite] = await Promise.all([
    safe(() => anon.authProviders(), { password: true, github: false, openSignup: false, needsOwner: false }),
    sp.invite ? safe(() => anon.invite(sp.invite!), null) : Promise.resolve(null),
  ]);
  const open = providers.needsOwner || providers.openSignup || Boolean(invite);
  return (
    <AuthShell
      title={invite ? `Join ${invite.team.name}` : providers.needsOwner ? "Set up Kiln" : "Create your account"}
      subtitle={
        invite
          ? `You were invited as ${invite.role === "member" ? "a member" : `an ${invite.role}`}.`
          : providers.needsOwner
            ? "You are the first person here, so you will own the default team."
            : undefined
      }
      footer={
        <>
          Already have an account? <AuthLink href={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Log in</AuthLink>
        </>
      }
    >
      {open ? (
        <>
          {providers.github && (
            <>
              <GitHubButton action={githubLogin} next={next} invite={sp.invite} />
              <OrDivider />
            </>
          )}
          <CredentialsForm action={signup} submitLabel={invite ? "Create account and join" : "Create account"} withName next={next} invite={sp.invite} email={invite?.email} lockEmail={Boolean(invite)} />
        </>
      ) : (
        <p className="rounded-xl border bg-muted/60 p-4 text-sm text-muted-foreground">
          {sp.invite ? "This invite link is no longer valid. Ask a team admin to resend it." : "Signing up needs an invite. Ask a team owner or admin to invite your email address."}
        </p>
      )}
    </AuthShell>
  );
}
