import type { Metadata } from "next";
import { AuthLink, AuthShell, CredentialsForm, GitHubButton, OrDivider } from "@/components/kiln/auth-shell";
import { api, safe } from "@/lib/kiln";
import { safeNext } from "@/lib/session";
import { githubLogin, login } from "./actions";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const providers = await safe(() => api.withToken("").authProviders(), { password: true, github: false, openSignup: false, needsOwner: false });
  return (
    <AuthShell
      title="Log in to Kiln"
      subtitle={providers.needsOwner ? "No one has signed up yet. The first account owns this Kiln." : "Welcome back."}
      footer={
        providers.needsOwner || providers.openSignup ? (
          <>
            New here? <AuthLink href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</AuthLink>
          </>
        ) : (
          "Need an account? Ask a team admin for an invite."
        )
      }
    >
      {sp.error && <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{sp.error}</p>}
      {providers.github && (
        <>
          <GitHubButton action={githubLogin} next={next} />
          <OrDivider />
        </>
      )}
      <CredentialsForm action={login} submitLabel="Log in" next={next} />
    </AuthShell>
  );
}
