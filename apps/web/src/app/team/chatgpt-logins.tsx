"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import type { ChatgptSignIn, PoolEntry } from "@kiln/sdk-ts";
import { ConfirmAction } from "@/components/kiln/confirm-action";
import { ConnectedBadge } from "@/components/kiln/settings-blocks";
import { SimpleSelect } from "@/components/kiln/simple-select";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { byHeadroom, resetsIn, tokenStatus } from "@/lib/claude-tokens";
import * as A from "./actions";

/**
 * ChatGPT logins: Codex runs OpenAI models on a ChatGPT plan. "Sign in with ChatGPT" shows a link and a
 * one-time code; once approved the login is stored and used like the Claude tokens above it.
 */
export function ChatgptLogins({ team, logins, isAdmin }: { team: string; logins: PoolEntry[]; isAdmin: boolean }) {
  const [form, setForm] = useState(false);
  const [name, setName] = useState("CHATGPT_");
  const [scope, setScope] = useState<"team" | "personal">(isAdmin ? "team" : "personal");
  const [signIn, setSignIn] = useState<ChatgptSignIn>();
  const [pending, run] = useAction();
  const router = useRouter();
  const validName = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name.trim());

  // Waits for the person to approve the code on auth.openai.com.
  useEffect(() => {
    if (signIn?.status !== "pending") return;
    const timer = setInterval(async () => {
      const r = await A.chatgptSignInStatus(team, signIn.id);
      if (!r.ok || !r.data || r.data.status === "pending") return;
      setSignIn(undefined);
      if (r.data.status === "succeeded") {
        toast.success(`Signed in${r.data.email ? ` as ${r.data.email}` : ""}${r.data.plan ? ` (${r.data.plan})` : ""}`);
        setForm(false);
        router.refresh();
      } else if (r.data.status === "failed") toast.error(`ChatGPT sign-in failed: ${r.data.error ?? "unknown error"}`);
    }, 2000);
    return () => clearInterval(timer);
  }, [signIn, team, router]);

  return (
    <div className="border-b pb-4 mb-4">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">ChatGPT logins</div>
          <div className="text-sm text-muted-foreground">
            Codex runs OpenAI models on a ChatGPT plan instead of an API key. Sign in, approve the code on OpenAI&apos;s page, and runs use the working login
            with the most left. The agent in a run can read the login, so use a dedicated ChatGPT account for team logins, within OpenAI&apos;s terms. Needs auth.openai.com and chatgpt.com in the egress allowlist.
          </div>
        </div>
        {!form && (
          <Button variant="outline" onClick={() => setForm(true)}>
            Sign in with ChatGPT
          </Button>
        )}
      </div>

      {logins.length === 0 && !form && (
        <p className="mt-3 text-sm text-muted-foreground">No ChatGPT logins yet. Codex runs fall back to the OpenAI API key below.</p>
      )}
      {logins.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg border bg-background">
          {byHeadroom(logins).map((l) => {
            const s = tokenStatus(l);
            const canManage = l.scope === "personal" || isAdmin;
            return (
              <li key={`${l.scope}:${l.name}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <code className="truncate font-mono text-xs">{l.name}</code>
                  {l.description && <span className="ml-2 text-xs text-muted-foreground">{l.description.replace(/^ChatGPT login /, "")}</span>}
                  {l.scope === "personal" && <span className="ml-2 text-xs text-muted-foreground">· only your runs</span>}
                </span>
                <ConnectedBadge tone={s.tone}>{s.label}</ConnectedBadge>
                {l.status === "limited" && l.resetsAt && <span className="text-xs text-muted-foreground">usable {resetsIn(l.resetsAt)}</span>}
                {l.status === "invalid" && l.error && (
                  <span className="w-full truncate text-xs text-destructive" title={l.error}>
                    Signed out: {l.error}. Sign in again with the same name to replace it.
                  </span>
                )}
                {canManage && (
                  <span className="flex gap-1">
                    {isAdmin && l.scope === "team" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => void run(() => A.checkChatgptLogin(team, l.name), { onSuccess: () => router.refresh() })}
                      >
                        Check now
                      </Button>
                    )}
                    <ConfirmAction
                      title={`Remove ${l.name}?`}
                      description="Runs stop using this login. The ChatGPT account itself is not signed out elsewhere."
                      confirmLabel="Remove"
                      action={() => A.deleteChatgptLogin(l.scope, l.name)}
                      onDone={() => router.refresh()}
                      trigger={(open) => (
                        <Button variant="ghost" size="sm" onClick={open} className="text-destructive hover:text-destructive">
                          Remove
                        </Button>
                      )}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {form && !signIn && (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => A.startChatgptSignIn(team, name, scope), { onSuccess: (s) => s && setSignIn(s) });
          }}
        >
          <Input
            autoFocus
            placeholder="CHATGPT_ALICE"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
            className="h-9 bg-background font-mono"
            aria-label="Login name"
          />
          {isAdmin ? (
            <SimpleSelect
              value={scope}
              onChange={(v: string) => setScope(v as "team" | "personal")}
              options={[
                { value: "team", label: "For the team" },
                { value: "personal", label: "Only my runs" },
              ]}
            />
          ) : (
            <span className="self-center text-xs text-muted-foreground">Only your runs</span>
          )}
          <Button type="button" variant="ghost" onClick={() => setForm(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !validName}>
            {pending ? "Starting…" : "Continue"}
          </Button>
        </form>
      )}

      {signIn?.status === "pending" && (
        <div className="mt-3 rounded-lg border bg-background p-4 text-sm">
          <p>
            1. Open{" "}
            <a href={signIn.verificationUrl} target="_blank" rel="noreferrer" className="font-medium underline">
              {signIn.verificationUrl}
            </a>{" "}
            and sign in to ChatGPT.
          </p>
          <p className="mt-2">2. Enter this code (expires {resetsIn(signIn.expiresAt)}):</p>
          <div className="mt-2 flex items-center gap-3">
            <code className="rounded-md border bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">{signIn.userCode}</code>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(signIn.userCode ?? "").then(() => toast.success("Code copied"))}
            >
              Copy
            </Button>
          </div>
          <p className="mt-3 text-muted-foreground">Waiting for you to approve it…</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => void A.cancelChatgptSignIn(team, signIn.id).then(() => setSignIn(undefined))}
          >
            Cancel sign-in
          </Button>
        </div>
      )}
    </div>
  );
}
