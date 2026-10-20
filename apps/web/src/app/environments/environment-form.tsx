"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Check, Plus, Trash2, X } from "lucide-react";
import type { EnvironmentTemplate } from "@kiln/sdk-ts";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { ConfirmAction } from "@/components/kiln/confirm-action";
import { PageHeader, Pre } from "@/components/kiln/ui";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { deleteEnvironment, saveEnvironment } from "./actions";

const REPO = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

export function EnvironmentForm({ env, secrets, canEdit }: { env?: EnvironmentTemplate; secrets: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, run] = useAction();
  const [name, setName] = useState(env?.name ?? "");
  const [image, setImage] = useState(env?.image ?? "");
  const [description, setDescription] = useState(env?.description ?? "");
  const [repos, setRepos] = useState(env?.repos ?? []);
  const [repoDraft, setRepoDraft] = useState("");
  const [commands, setCommands] = useState<string[]>(env?.setupCommands.length ? env.setupCommands : [""]);
  const [chosen, setChosen] = useState<string[]>(env?.secrets ?? []);
  const repoOk = !repoDraft || REPO.test(repoDraft.trim());
  const valid = canEdit && name.trim().length > 0 && repoOk;

  const addRepo = () => {
    const m = REPO.exec(repoDraft.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, ""));
    if (!m) return;
    if (!repos.some((r) => r.owner === m[1] && r.name === m[2])) setRepos([...repos, { owner: m[1]!, name: m[2]! }]);
    setRepoDraft("");
  };

  const save = () => {
    const pendingRepo = REPO.exec(repoDraft.trim());
    const allRepos = pendingRepo && !repos.some((r) => r.owner === pendingRepo[1] && r.name === pendingRepo[2]) ? [...repos, { owner: pendingRepo[1]!, name: pendingRepo[2]! }] : repos;
    return run(() => saveEnvironment(env?.id, { name, image, description, repos: allRepos, setupCommands: commands, secrets: chosen }), { onSuccess: () => router.push("/environments") });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
    >
      <PageHeader
        crumbs={[{ label: "Environments", href: "/environments" }, { label: name || "Untitled" }]}
        actions={
          canEdit && (
            <>
              {env && (
                <ConfirmAction
                  title={`Delete ${env.name}?`}
                  description="Factories, agents and automations that point at it fail to start runs until they use another environment."
                  action={() => deleteEnvironment(env.id, env.name)}
                  onDone={() => router.push("/environments")}
                  trigger={(open) => (
                    <Button type="button" variant="ghost" size="icon" aria-label="Delete environment" onClick={open} className="text-muted-foreground hover:text-destructive">
                      <Trash2 />
                    </Button>
                  )}
                />
              )}
              <Button type="submit" variant={valid ? "default" : "secondary"} disabled={!valid || pending} className="h-8 px-3">
                {pending ? "Saving…" : "Save"}
              </Button>
            </>
          )
        }
      />
      <fieldset disabled={!canEdit} className="mx-auto w-full max-w-[672px] px-6 pt-6 pb-20">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Boxes className="size-5" />
          </span>
          <input
            aria-label="Environment name"
            autoFocus={!env}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled"
            maxLength={100}
            className="h-12 min-w-0 flex-1 rounded-lg border-2 border-transparent bg-transparent px-1 text-2xl font-semibold outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
          />
        </div>

        <label className="mt-6 grid gap-1.5">
          <span className="text-sm font-medium">Docker image</span>
          <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="node:24-bookworm" className="h-10 font-mono" />
          <span className="text-xs text-muted-foreground">Used when an agent names no runner. It needs bash and coreutils. Leave empty for the server&apos;s default image.</span>
        </label>

        <div className="mt-6 grid gap-1.5">
          <span className="text-sm font-medium">Repositories</span>
          <span className="text-xs text-muted-foreground">Cloned next to the factory&apos;s own repositories.</span>
          {repos.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {repos.map((r) => (
                <li key={`${r.owner}/${r.name}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <GitHubIcon className="size-4" />
                  <span className="flex-1 font-mono">
                    {r.owner}/{r.name}
                  </span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${r.owner}/${r.name}`} onClick={() => setRepos(repos.filter((x) => x !== r))}>
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              value={repoDraft}
              onChange={(e) => setRepoDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRepo();
                }
              }}
              placeholder="owner/repo"
              aria-invalid={!repoOk}
              className="h-9 font-mono"
            />
            <Button type="button" variant="outline" className="h-9" onClick={addRepo} disabled={!repoDraft.trim() || !repoOk}>
              <Plus /> Add repo
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-1.5">
          <span className="text-sm font-medium">Setup commands</span>
          <span className="text-xs text-muted-foreground">Run in order after the runner&apos;s setup commands. A command that fails stops the run.</span>
          {commands.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input
                aria-label={`Setup command ${i + 1}`}
                value={c}
                onChange={(e) => setCommands(commands.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={i === 0 ? "cd my-repo && npm install" : `Setup command ${i + 1}`}
                className="h-9 font-mono"
              />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove setup command ${i + 1}`} disabled={commands.length === 1 && !c} onClick={() => setCommands(commands.length === 1 ? [""] : commands.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" className="w-fit" onClick={() => setCommands([...commands, ""])}>
            <Plus /> Add command
          </Button>
        </div>

        <div className="mt-6 grid gap-1.5">
          <span className="text-sm font-medium">Secrets</span>
          <span className="text-xs text-muted-foreground">Added to the secrets of every agent that uses this environment.</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {chosen.map((s) => (
              <span key={s} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs", !secrets.includes(s) && "border-amber-600/40 text-amber-700 dark:text-amber-400")} title={secrets.includes(s) ? undefined : "No secret with this name yet"}>
                {s}
                <button type="button" aria-label={`Remove ${s}`} onClick={() => setChosen(chosen.filter((x) => x !== s))} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <SecretPicker secrets={secrets} chosen={chosen} onToggle={(s) => setChosen(chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s])} />
          </div>
        </div>

        <label className="mt-6 grid gap-1.5">
          <span className="text-xs font-medium">Description (optional)</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this environment for?" className="min-h-28" maxLength={500} />
        </label>

        <div className="mt-6 border-t pt-5 text-sm">
          <div className="mb-2 font-medium">Use it in a factory</div>
          <Pre>{`# factory.yaml\nagentDefaults:\n  environmentId: ${name.trim() || "my-environment"}`}</Pre>
          <p className="mt-2 text-xs text-muted-foreground">An agent or automation can set its own environmentId. The most specific setting wins.</p>
        </div>
      </fieldset>
    </form>
  );
}

function SecretPicker({ secrets, chosen, onToggle }: { secrets: string[]; chosen: string[]; onToggle: (s: string) => void }) {
  const [q, setQ] = useState("");
  const shown = secrets.filter((s) => s.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" />}>
        <Plus /> Add secret
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search secrets" className="mb-1 h-8" />
        <div className="max-h-60 overflow-y-auto">
          {shown.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No secrets. Add them under Secrets.</div>}
          {shown.map((s) => (
            <button key={s} type="button" onClick={() => onToggle(s)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-muted">
              <span className="flex-1 truncate">{s}</span>
              {chosen.includes(s) && <Check className="size-3.5 text-violet-600" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
