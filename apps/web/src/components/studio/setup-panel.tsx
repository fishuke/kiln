"use client";

import Link from "next/link";
import { Circle, CircleCheck, CircleX, GitBranch, KeyRound, LoaderCircle, Package, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { SetupStep } from "@/lib/studio/model";
import type { StudioApp } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

const STEP_ICON: Record<SetupStep["status"], React.ReactNode> = {
  done: <CircleCheck className="text-emerald-600 dark:text-emerald-400" />,
  running: <LoaderCircle className="animate-spin text-violet-600 dark:text-violet-400" />,
  failed: <CircleX className="text-destructive" />,
  pending: <Circle className="text-muted-foreground/50" />,
};

/** The Task pattern for an import: one line per step, the running one shimmering. */
export function ImportSteps({ steps }: { steps: SetupStep[] }) {
  return (
    <Trace className="gap-1">
      {steps.map((s) => (
        <TraceLine
          key={s.id}
          status={s.status === "running" ? "running" : s.status === "failed" ? "error" : s.status === "pending" ? "pending" : undefined}
          className={cn("h-8 w-full max-w-none rounded-md px-2", s.status === "running" && "bg-muted/60 text-foreground")}
        >
          <TraceIcon>{STEP_ICON[s.status]}</TraceIcon>
          <TraceTitle>{s.label}</TraceTitle>
        </TraceLine>
      ))}
    </Trace>
  );
}

/** Detected dev command, with an override. */
export function DevCommand({ app, onSave }: { app: StudioApp; onSave: (cmd: string | null) => Promise<void> }) {
  const setup = app.setup;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(setup?.dev ?? "");
  if (!setup) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">Dev command</Label>
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSave(value.trim() || null);
            setEditing(false);
          }}
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono text-xs"
            autoFocus
            aria-label="Dev command"
            placeholder={setup.devDetected ?? "npm run dev"}
          />
          <Button type="submit" size="sm">
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <code className="flex h-8 min-w-0 flex-1 items-center gap-2 truncate rounded-md border bg-muted/40 px-2.5 font-mono text-xs">
            <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
            {setup.dev ?? <span className="text-muted-foreground">None found in package.json</span>}
          </code>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Change
          </Button>
          {setup.devOverride && (
            <Button size="sm" variant="ghost" onClick={() => void onSave(null)}>
              Use detected
            </Button>
          )}
        </div>
      )}
      <span className="text-xs text-muted-foreground">
        {setup.devOverride
          ? `Detected: ${setup.devDetected ?? "none"}`
          : setup.devDetected
            ? "From package.json"
            : "No dev script in package.json"}
      </span>
    </div>
  );
}

/** Missing env: one field per key, saved as team secrets. Values never go into the repository. */
export function MissingEnv({ keys, onSave }: { keys: string[]; onSave: (values: Record<string, string>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!keys.length) return null;
  const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(filled);
          setValues({});
          toast.success("Secrets saved");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex items-start gap-2 text-sm">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <div className="font-medium">
            Missing environment {keys.length === 1 ? "variable" : "variables"}
          </div>
          <div className="text-xs text-muted-foreground">
            From .env.example. Saved as team{" "}
            <Link href="/secrets" className="underline underline-offset-2 hover:text-foreground">
              secrets
            </Link>
            .
          </div>
        </div>
      </div>
      {keys.map((k) => (
        <div key={k} className="grid gap-1">
          <Label htmlFor={`env-${k}`} className="font-mono text-xs">
            {k}
          </Label>
          <Input
            id={`env-${k}`}
            type="password"
            autoComplete="off"
            value={values[k] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
          />
        </div>
      ))}
      <Button type="submit" size="sm" className="self-end" disabled={busy || !Object.keys(filled).length}>
        Save secrets
      </Button>
    </form>
  );
}

/** An imported app being set up: progress steps, what was detected, and missing env. */
export function SetupPanel({
  app,
  steps,
  onDevCommand,
  onSecrets,
}: {
  app: StudioApp;
  steps: SetupStep[];
  onDevCommand: (cmd: string | null) => Promise<void>;
  onSecrets: (values: Record<string, string>) => Promise<void>;
}) {
  const source = app.source.kind === "repo" ? app.source : undefined;
  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-6 sm:items-center">
      <div className="flex w-full max-w-md flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl border bg-background">
            <GitHubIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">Importing {source?.repo ?? app.name}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="size-3" />
              {app.setup?.mainBranch ?? source?.branch ?? "default branch"}
              {app.setup && (
                <>
                  <Package className="ml-2 size-3" />
                  {app.setup.packageManager}
                </>
              )}
            </div>
          </div>
        </div>
        <ImportSteps steps={steps} />
        {app.error && <p className="text-sm text-destructive">{app.error}</p>}
        {app.setup && <DevCommand app={app} onSave={onDevCommand} />}
        {app.setup && <MissingEnv keys={app.setup.envMissing} onSave={onSecrets} />}
      </div>
    </div>
  );
}
