"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitHubIcon } from "./brand-icons";

export function KilnMark({ className = "size-8" }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-lg bg-foreground text-background ${className}`}>
      <svg viewBox="0 0 16 16" className="size-1/2" fill="currentColor" aria-hidden>
        <path d="M3 13.5 6.2 2.5h2.6L5.6 13.5zM7.4 13.5l3.2-11h2.6l-3.2 11z" />
      </svg>
    </span>
  );
}

/** Full-screen centered column for login, signup and invite pages (no app sidebar). */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-[360px]">
        <KilnMark className="mb-6 size-9" />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-8 text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  );
}

type AuthState = { error?: string; email?: string; name?: string };

export function CredentialsForm({
  action,
  submitLabel,
  withName,
  next,
  invite,
  email,
  lockEmail,
}: {
  action: (prev: AuthState, form: FormData) => Promise<AuthState>;
  submitLabel: string;
  withName?: boolean;
  next?: string;
  invite?: string;
  email?: string;
  lockEmail?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { email });
  return (
    <form action={formAction} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      {invite && <input type="hidden" name="invite" value={invite} />}
      {withName && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Name</span>
          <Input name="name" autoComplete="name" defaultValue={state.name} placeholder="Ada Lovelace" className="h-10" />
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Email</span>
        <Input name="email" type="email" required autoComplete="email" autoFocus={!lockEmail} readOnly={lockEmail} defaultValue={state.email ?? email} placeholder="you@company.com" className="h-10 read-only:bg-muted" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Password</span>
        <Input name="password" type="password" required minLength={withName ? 8 : 1} autoComplete={withName ? "new-password" : "current-password"} autoFocus={lockEmail} className="h-10" />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-10 w-full">
        {pending ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}

export function GitHubButton({ action, next, invite }: { action: (form: FormData) => Promise<void>; next?: string; invite?: string }) {
  return (
    <form action={action}>
      {next && <input type="hidden" name="next" value={next} />}
      {invite && <input type="hidden" name="invite" value={invite} />}
      <Button type="submit" variant="outline" className="h-10 w-full">
        <GitHubIcon className="size-4" /> Continue with GitHub
      </Button>
    </form>
  );
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-foreground underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
