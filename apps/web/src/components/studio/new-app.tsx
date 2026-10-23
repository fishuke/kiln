"use client";

import { useRouter } from "next/navigation";
import { ExternalLink, LayoutTemplate, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GitHubIcon } from "@/components/kiln/brand-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { StudioClient } from "@/lib/studio/client";
import type { AppSource, ForgeRepository } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

type Path = "template" | "repo";

/** "New app": Start from template (with a first prompt) or Import from GitHub (repository and branch). */
export function NewAppDialog({ client, defaultOpen }: { client: StudioClient; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [path, setPath] = useState<Path>("template");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [repos, setRepos] = useState<ForgeRepository[]>();
  const [repo, setRepo] = useState<string>();
  const [branch, setBranch] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const source: AppSource =
    path === "repo" && repo ? { kind: "repo", repo, ...(branch.trim() ? { branch: branch.trim() } : {}) } : { kind: "template", template: "nextjs" };
  const appName = name.trim() || (path === "repo" && repo ? repo.split("/")[1]! : "");

  useEffect(() => {
    if (open && path === "repo" && !repos)
      client.repositories().then(setRepos, (e: unknown) => {
        setRepos([]);
        toast.error(e instanceof Error ? e.message : String(e));
      });
  }, [open, path, repos, client]);

  useEffect(() => {
    if (!open || path !== "repo") return;
    // Coming back from Integrations after adding a repository or an organization: list them again.
    const refresh = () => client.repositories().then(setRepos, () => {});
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open, path, client]);

  const create = async () => {
    if (!appName || (path === "repo" && !repo)) return;
    setBusy(true);
    try {
      const app = await client.createApp({ name: appName, source });
      if (path === "template" && prompt.trim()) await client.newChat(app.id, { prompt: prompt.trim() });
      setOpen(false);
      router.push(`/studio/${app.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = (repos ?? []).filter((r) => !filter || `${r.owner}/${r.name}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus data-icon="inline-start" />
        New app
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New app</DialogTitle>
          <DialogDescription>Start from a template or import a repository.</DialogDescription>
        </DialogHeader>
        <form
          id="new-app"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Tabs
            value={path}
            onValueChange={(v) => {
              setPath(v as Path);
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="template">
                <LayoutTemplate />
                Start from template
              </TabsTrigger>
              <TabsTrigger value="repo">
                <GitHubIcon className="size-4" />
                Import from GitHub
              </TabsTrigger>
            </TabsList>
            <TabsContent value="template" className="flex flex-col gap-4 pt-2">
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background">N</span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">Next.js</span>
                  <span className="text-xs text-muted-foreground">App Router, TypeScript, Tailwind</span>
                </span>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="new-app-prompt">Prompt</Label>
                <Textarea
                  id="new-app-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A habit tracker with streaks and a weekly heatmap"
                  className="min-h-20"
                />
              </div>
            </TabsContent>
            <TabsContent value="repo" className="flex flex-col gap-3 pt-2">
              <Input placeholder="Search repositories" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search repositories" />
              <div role="listbox" aria-label="Repositories" className="flex max-h-48 flex-col overflow-y-auto rounded-lg border p-1">
                {!repos && <div className="shimmer p-3 text-sm text-muted-foreground">Loading repositories…</div>}
                {repos && !shown.length && <div className="p-3 text-sm text-muted-foreground">No repositories yet. Add one from GitHub.</div>}
                {shown.map((r) => {
                  const id = `${r.owner}/${r.name}`;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={repo === id}
                      onClick={() => setRepo(id)}
                      className={cn("flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted", repo === id && "bg-muted font-medium")}
                    >
                      <GitHubIcon className="size-4 shrink-0" />
                      <span className="text-muted-foreground">{r.owner}/</span>
                      <span className="-ml-2 truncate">{r.name}</span>
                    </button>
                  );
                })}
              </div>
              <a
                href="/integrations?open=github"
                target="_blank"
                rel="noreferrer"
                className="-mt-1 flex h-8 items-center gap-2 self-start rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-4" />
                Add repository
                <ExternalLink className="size-3.5" />
              </a>
              <div className="grid gap-1.5">
                <Label htmlFor="new-app-branch">Branch</Label>
                <Input
                  id="new-app-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="The repository's default branch"
                  className="font-mono text-xs"
                />
              </div>
            </TabsContent>
          </Tabs>
          <div className="grid gap-1.5">
            <Label htmlFor="new-app-name">Name</Label>
            <Input
              id="new-app-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={path === "repo" && repo ? repo.split("/")[1] : "Habit tracker"}
            />
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="new-app" disabled={busy || !appName || (path === "repo" && !repo)}>
            {path === "repo" ? "Import" : "Create app"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
