import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/kiln/auth-shell";
import { AvatarBox } from "@/components/kiln/settings-blocks";
import { buttonVariants } from "@/components/ui/button";
import { api, requestAuth, safe } from "@/lib/kiln";
import { AcceptInviteButton } from "./accept-button";

export const metadata: Metadata = { title: "Invite" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, me, auth] = await Promise.all([safe(() => api.withToken("").invite(token), null), safe(() => api.me(), null), requestAuth()]);
  if (!invite) {
    return (
      <AuthShell title="Invite not found" subtitle="This invite link has expired, was revoked, or was already used.">
        <Link href="/login" className={buttonVariants({ variant: "outline", className: "h-10 w-full" })}>
          Go to log in
        </Link>
      </AuthShell>
    );
  }
  const signedIn = Boolean(me?.user);
  const here = `/invite/${encodeURIComponent(token)}`;
  const otherEmail = me?.user && me.user.email.toLowerCase() !== invite.email.toLowerCase();
  return (
    <AuthShell title={`Join ${invite.team.name}`} subtitle={<>{invite.email} was invited to this team on Kiln.</>}>
      <div className="mb-6 flex items-center gap-3 rounded-xl border bg-muted/60 p-4">
        <AvatarBox src={invite.team.avatar} name={invite.team.name} square className="size-10" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{invite.team.name}</div>
          <div className="text-sm text-muted-foreground">
            Role: <span className="capitalize">{invite.role}</span> · expires {new Date(invite.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
        </div>
      </div>
      {signedIn ? (
        <div className="space-y-3">
          {otherEmail && (
            <p className="text-sm text-muted-foreground">
              You are signed in as <span className="font-medium text-foreground">{me!.user!.email}</span>.{" "}
              {auth.signedIn && (
                <a href={`/logout?next=${encodeURIComponent(here)}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                  Use another account
                </a>
              )}
            </p>
          )}
          <AcceptInviteButton token={token} />
        </div>
      ) : (
        <div className="space-y-3">
          <Link href={`/signup?invite=${encodeURIComponent(token)}`} className={buttonVariants({ className: "h-10 w-full" })}>
            Create account and join
          </Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`} className={buttonVariants({ variant: "outline", className: "h-10 w-full" })}>
            I already have an account
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
