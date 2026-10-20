"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, ChevronsDownUp, ExternalLink, File, FileCode2, Folder, FolderOpen, FolderUp, MoreHorizontal, Pencil, Plus, Trash2, Upload, Workflow } from "lucide-react";
import { toast } from "sonner";
import { CodeEditor, type EditorMarker } from "@/components/kiln/code-editor";
import { PageHeader } from "@/components/kiln/ui";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { buildTree, cleanPath, filterPaths, languageFor, NEW_KINDS, newResource, parseDiagnostic, type Diagnostic, type NewKind, type TreeNode } from "@/lib/definition-tree";
import { toastResult } from "@/lib/toast-result";
import { cn } from "@/lib/utils";
import { saveDefinition, validateTree } from "../actions";

const BANNER_KEY = "kiln-definition-banner-hidden";

type Prompt = { kind: "file" | "dir" | NewKind; parent: string } | { kind: "rename"; path: string; isDir: boolean };

function FileIcon({ path }: { path: string }) {
  if (path === "factory.yaml") return <Workflow className="size-4 shrink-0 text-fuchsia-600 dark:text-fuchsia-400" />;
  if (/\.mdx?$/.test(path)) return <span className="w-4 shrink-0 text-center text-[10px] leading-none font-bold text-emerald-600 dark:text-emerald-400">M↓</span>;
  if (/\.ya?ml$/.test(path)) return <FileCode2 className="size-4 shrink-0 text-muted-foreground" />;
  return <File className="size-4 shrink-0 text-muted-foreground" />;
}

export type DefinitionEditorProps = {
  factory: string;
  factoryName: string;
  tree: Record<string, string>;
  sha: string;
  repo?: { owner: string; name: string; ref: string; dir?: string };
  initialFile?: string;
  importMode?: boolean;
  defaultAgent?: string;
  judgeModel?: string;
};

export function DefinitionEditor(p: DefinitionEditorProps) {
  const router = useRouter();
  const [base, setBase] = useState(p.tree);
  const [files, setFiles] = useState(p.tree);
  const [dirs, setDirs] = useState<string[]>([]);
  const initial = p.initialFile && p.initialFile in p.tree ? p.initialFile : "factory.yaml" in p.tree ? "factory.yaml" : Object.keys(p.tree).sort()[0];
  const [selected, setSelected] = useState<string | undefined>(initial);
  const [selectedDir, setSelectedDir] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState(256);
  const [bannerHidden, setBannerHidden] = useState(true);
  const [editing, setEditing] = useState(!p.repo);
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [problemsOpen, setProblemsOpen] = useState(true);
  const [validating, setValidating] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [deleting, setDeleting] = useState<{ path: string; isDir: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | undefined>();
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setBannerHidden(localStorage.getItem(BANNER_KEY) === "1");
    } catch {
      setBannerHidden(false);
    }
  }, []);

  useEffect(() => {
    if (p.importMode) fileInput.current?.click();
  }, [p.importMode]);

  const changes = useMemo(() => {
    const out: { path: string; content: string | null }[] = [];
    for (const [path, content] of Object.entries(files)) if (base[path] !== content) out.push({ path, content });
    for (const path of Object.keys(base)) if (!(path in files)) out.push({ path, content: null });
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }, [files, base]);
  const changed = useMemo(() => new Set(changes.map((c) => c.path)), [changes]);
  const dirty = changes.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const validate = useCallback(
    async (tree: Record<string, string>) => {
      setValidating(true);
      const r = await validateTree(tree);
      setValidating(false);
      if (!r.ok) return void toast.error(r.error);
      setDiags([...r.errors.map((e) => parseDiagnostic(e, "error")), ...r.warnings.map((w) => parseDiagnostic(w, "warning"))]);
    },
    [setDiags],
  );

  // Validate edits as they happen (debounced); the stored definition was valid when applied.
  useEffect(() => {
    if (!dirty) {
      setDiags([]);
      return;
    }
    const t = setTimeout(() => void validate(files), 800);
    return () => clearTimeout(t);
  }, [files, dirty, validate]);

  const paths = useMemo(() => Object.keys(files), [files]);
  const shownPaths = useMemo(() => filterPaths(paths, query), [paths, query]);
  const tree = useMemo(() => buildTree(shownPaths, query ? [] : dirs), [shownPaths, dirs, query]);
  const diagByFile = useMemo(() => {
    const m = new Map<string, Diagnostic[]>();
    for (const d of diags) if (d.path) m.set(d.path, [...(m.get(d.path) ?? []), d]);
    return m;
  }, [diags]);
  const markers: EditorMarker[] = (selected ? diagByFile.get(selected) ?? [] : []).map((d) => ({ line: d.line ?? 1, message: d.message, severity: d.severity }));
  const errors = diags.filter((d) => d.severity === "error").length;

  const open = (path: string) => {
    setSelected(path);
    setSelectedDir(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    const params = new URLSearchParams(window.location.search);
    params.set("file", path);
    params.delete("import");
    window.history.replaceState(null, "", `?${params}`);
  };

  const addFile = (path: string, content: string) => {
    setFiles((f) => ({ ...f, [path]: content }));
    open(path);
  };

  const removePath = (path: string, isDir: boolean) => {
    setFiles((f) => Object.fromEntries(Object.entries(f).filter(([k]) => (isDir ? !k.startsWith(`${path}/`) : k !== path))));
    setDirs((d) => d.filter((x) => (isDir ? x !== path && !x.startsWith(`${path}/`) : true)));
    if (selected && (isDir ? selected.startsWith(`${path}/`) : selected === path)) setSelected(undefined);
  };

  const renamePath = (from: string, to: string, isDir: boolean) => {
    setFiles((f) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(f)) {
        if (isDir ? k.startsWith(`${from}/`) : k === from) next[isDir ? `${to}${k.slice(from.length)}` : to] = v;
        else next[k] = v;
      }
      return next;
    });
    setDirs((d) => d.map((x) => (x === from || x.startsWith(`${from}/`) ? `${to}${x.slice(from.length)}` : x)));
    if (selected && (isDir ? selected.startsWith(`${from}/`) : selected === from)) setSelected(isDir ? `${to}${selected.slice(from.length)}` : to);
  };

  const submitPrompt = () => {
    if (!prompt) return;
    const value = promptValue.trim();
    if (!value) return;
    if (prompt.kind === "rename") {
      const parent = prompt.path.includes("/") ? prompt.path.slice(0, prompt.path.lastIndexOf("/") + 1) : "";
      const to = cleanPath(parent + value);
      if (!to) return void toast.error("Use a valid name");
      if (to in files || dirs.includes(to)) return void toast.error(`${to} already exists`);
      renamePath(prompt.path, to, prompt.isDir);
    } else if (prompt.kind === "file" || prompt.kind === "dir") {
      const path = cleanPath(prompt.parent ? `${prompt.parent}/${value}` : value);
      if (!path) return void toast.error("Use a valid path");
      if (path in files) return void toast.error(`${path} already exists`);
      if (prompt.kind === "dir") {
        setDirs((d) => [...d, path]);
        setSelectedDir(path);
        setCollapsed((c) => new Set([...c].filter((x) => !path.startsWith(x))));
      } else addFile(path, "");
    } else {
      const r = newResource(prompt.kind, value, { agent: p.defaultAgent, model: p.judgeModel });
      if (r.path in files) return void toast.error(`${r.path} already exists`);
      addFile(r.path, r.content);
    }
    setPrompt(null);
  };

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const target = selectedDir;
    let added = 0;
    const skipped: string[] = [];
    const next: Record<string, string> = {};
    for (const f of Array.from(list)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      const path = cleanPath(target ? `${target}/${rel}` : rel);
      if (!path || f.size > 1_000_000) {
        skipped.push(rel);
        continue;
      }
      const text = await f.text();
      if (text.includes("\u0000")) {
        skipped.push(rel);
        continue;
      }
      next[path] = text;
      added++;
    }
    setFiles((f) => ({ ...f, ...next }));
    if (added) {
      toast.success(`Added ${added} file${added === 1 ? "" : "s"}; save to apply`);
      open(Object.keys(next)[0]!);
    }
    if (skipped.length) toast.error(`Skipped ${skipped.length} binary or large file${skipped.length === 1 ? "" : "s"}`, { description: skipped.slice(0, 5).join(", ") });
  };

  const save = () =>
    start(async () => {
      const r = await saveDefinition(p.factory, changes, message);
      if (!toastResult(r, `Saved ${changes.length} file${changes.length === 1 ? "" : "s"}`)) {
        if (!r.ok && r.errors?.length) setDiags(r.errors.map((e) => parseDiagnostic(e, "error")));
        return;
      }
      setSaving(false);
      setMessage("");
      if (r.ok && !r.pullRequest) setBase(files);
      router.refresh();
    });

  const repoUrl = p.repo ? `https://github.com/${p.repo.owner}/${p.repo.name}/tree/${p.repo.ref}${p.repo.dir ? `/${p.repo.dir}` : ""}` : undefined;

  const newMenu = (parent: string) => (
    <>
      <DropdownMenuItem onClick={() => (setPromptValue(""), setPrompt({ kind: "file", parent }))}>
        <File /> New File
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => (setPromptValue(""), setPrompt({ kind: "dir", parent }))}>
        <Folder /> New Directory
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {NEW_KINDS.map((k) => (
        <DropdownMenuItem key={k.kind} onClick={() => (setPromptValue(""), setPrompt({ kind: k.kind, parent }))}>
          <Plus /> {k.label}
        </DropdownMenuItem>
      ))}
    </>
  );

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.kind === "dir") {
      const isOpen = query ? true : !collapsed.has(node.path);
      return (
        <li key={`d:${node.path}`}>
          <Row
            depth={depth}
            active={false}
            onClick={() => {
              setSelectedDir(node.path);
              setCollapsed((c) => {
                const n = new Set(c);
                if (n.has(node.path)) n.delete(node.path);
                else n.add(node.path);
                return n;
              });
            }}
            icon={isOpen ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            label={node.name}
            menu={
              editing && (
                <>
                  {newMenu(node.path)}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => (setPromptValue(node.name), setPrompt({ kind: "rename", path: node.path, isDir: true }))}>
                    <Pencil /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleting({ path: node.path, isDir: true })}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </>
              )
            }
          />
          {isOpen && <ul>{node.children.map((c) => renderNode(c, depth + 1))}</ul>}
        </li>
      );
    }
    const d = diagByFile.get(node.path);
    return (
      <li key={`f:${node.path}`}>
        <Row
          depth={depth}
          active={selected === node.path}
          onClick={() => open(node.path)}
          icon={<FileIcon path={node.path} />}
          label={node.name}
          tone={d?.some((x) => x.severity === "error") ? "error" : d?.length ? "warning" : undefined}
          changed={changed.has(node.path)}
          menu={
            editing && (
              <>
                <DropdownMenuItem onClick={() => (setPromptValue(node.name), setPrompt({ kind: "rename", path: node.path, isDir: false }))}>
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => addFile(uniqueCopy(node.path, files), files[node.path] ?? "")}>
                  <File /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setDeleting({ path: node.path, isDir: false })}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            )
          }
        />
      </li>
    );
  };

  const allDirs = useMemo(() => {
    const out: string[] = [];
    const walk = (n: TreeNode) => n.children.forEach((c) => c.kind === "dir" && (out.push(c.path), walk(c)));
    walk(buildTree(paths, dirs));
    return out;
  }, [paths, dirs]);

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        crumbs={[{ label: p.factoryName, href: `/f/${p.factory}/dashboard` }, { label: "Factory definition" }]}
        actions={
          <>
            {repoUrl && (
              <a href={repoUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "ghost" })}>
                {p.repo!.owner}/{p.repo!.name} <ExternalLink />
              </a>
            )}
            <Link href={`/f/${p.factory}/settings#factory-repo`} className={buttonVariants({ variant: "outline" })}>
              Settings
            </Link>
            {p.repo && !editing ? (
              <Button variant="outline" onClick={() => setEditing(true)}>
                Edit and open PR
              </Button>
            ) : (
              <Button onClick={() => setSaving(true)} disabled={!dirty || pending} variant={dirty ? "default" : "secondary"}>
                {p.repo ? "Open PR with changes" : "Save"}
                {dirty && <span className="ml-0.5 rounded-full bg-background/20 px-1.5 text-xs">{changes.length}</span>}
              </Button>
            )}
          </>
        }
      />
      {!bannerHidden && (
        <div className="flex items-center gap-4 border-b px-6 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300">
            <FileCode2 className="size-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">Your Factory is defined in code</p>
            <p className="text-muted-foreground">Agents, automations, runners, and settings live as files. You can edit them directly here or just ask the factory to edit itself.</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setBannerHidden(true);
              try {
                localStorage.setItem(BANNER_KEY, "1");
              } catch {
                /* storage blocked */
              }
            }}
          >
            Don&apos;t show this again
          </Button>
        </div>
      )}
      {p.repo && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-6 py-2 text-xs text-muted-foreground">
          This definition lives in{" "}
          <a href={repoUrl} target="_blank" rel="noreferrer" className="font-medium text-foreground underline">
            {p.repo.owner}/{p.repo.name}
          </a>{" "}
          ({p.repo.ref}
          {p.repo.dir ? `, ${p.repo.dir}/` : ""}). {editing ? "Your changes go into a pull request; merging it applies them." : "Files are read-only here; edit to open a pull request."}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside style={{ width }} className="relative flex shrink-0 flex-col border-r">
          <div className="p-3">
            <input aria-label="Search files" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
          </div>
          <div className="group/root flex items-center gap-1.5 px-3 py-1 text-sm">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5" onClick={() => (setSelectedDir(""), setSelected(selected))}>
              <FolderOpen className="size-4 text-muted-foreground" /> <span className="truncate">Factory definition</span>
            </button>
            {editing && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Upload" className="opacity-0 group-hover/root:opacity-100 aria-expanded:opacity-100 focus-visible:opacity-100" />}>
                  <Upload />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => fileInput.current?.click()}>
                    <Upload /> Upload Files
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => folderInput.current?.click()}>
                    <FolderUp /> Upload Folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {editing && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="New" className="opacity-0 group-hover/root:opacity-100 aria-expanded:opacity-100 focus-visible:opacity-100" />}>
                  <Plus />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {newMenu(selectedDir)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="ghost" size="icon-xs" aria-label="Collapse all" className="opacity-0 group-hover/root:opacity-100 focus-visible:opacity-100" onClick={() => setCollapsed(new Set(allDirs))}>
              <ChevronsDownUp />
            </Button>
          </div>
          <nav aria-label="Definition files" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
            <ul>{tree.children.map((n) => renderNode(n, 1))}</ul>
            {!shownPaths.length && <p className="px-3 py-4 text-sm text-muted-foreground">{query ? "No files match." : "No files yet."}</p>}
          </nav>
          <ResizeHandle width={width} onChange={setWidth} />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {selected && selected in files ? (
            <>
              <div className="flex h-9 items-center gap-2 border-b px-4 font-mono text-xs text-muted-foreground">
                {selected}
                {changed.has(selected) && <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">modified</span>}
                {!editing && <span className="ml-auto">read-only</span>}
              </div>
              <div className="min-h-0 flex-1">
                <CodeEditor path={selected} value={files[selected] ?? ""} language={languageFor(selected)} readOnly={!editing} markers={markers} revealLine={reveal} onChange={(v) => setFiles((f) => ({ ...f, [selected]: v }))} />
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select a file</div>
          )}
          <div className="border-t">
            <button type="button" onClick={() => setProblemsOpen((o) => !o)} className="flex h-8 w-full items-center gap-2 px-4 text-xs">
              {problemsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              <span className="font-medium">Problems</span>
              {errors > 0 && (
                <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                  <AlertCircle className="size-3.5" /> {errors}
                </span>
              )}
              {diags.length - errors > 0 && (
                <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3.5" /> {diags.length - errors}
                </span>
              )}
              <span className="ml-auto text-muted-foreground">{validating ? "Validating…" : dirty ? (diags.length ? "" : "No problems") : "Saved definition is valid"}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => (e.stopPropagation(), void validate(files))}
                onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), void validate(files))}
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Validate
              </span>
            </button>
            {problemsOpen && diags.length > 0 && (
              <ul className="max-h-40 overflow-y-auto pb-1 text-xs">
                {diags.map((d, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        if (d.path && d.path in files) {
                          open(d.path);
                          setReveal({ line: d.line ?? 1, nonce: Date.now() });
                        }
                      }}
                      className="flex w-full items-start gap-2 px-4 py-1 text-left hover:bg-muted/50"
                    >
                      {d.severity === "error" ? <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
                      <span className="min-w-0">
                        {d.message}
                        {d.path && (
                          <span className="ml-2 font-mono text-muted-foreground">
                            {d.path}
                            {d.line ? `:${d.line}` : ""}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <input ref={fileInput} type="file" multiple hidden onChange={(e) => (void upload(e.target.files), (e.target.value = ""))} />
      <input
        ref={(el) => {
          folderInput.current = el;
          el?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        hidden
        onChange={(e) => (void upload(e.target.files), (e.target.value = ""))}
      />

      <Dialog open={prompt !== null} onOpenChange={(o) => !o && setPrompt(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{prompt?.kind === "rename" ? "Rename" : prompt?.kind === "file" ? "New file" : prompt?.kind === "dir" ? "New directory" : NEW_KINDS.find((k) => k.kind === prompt?.kind)?.label}</DialogTitle>
            {prompt && prompt.kind !== "rename" && (prompt.kind === "file" || prompt.kind === "dir") && <DialogDescription>In {prompt.parent ? `${prompt.parent}/` : "the root"}</DialogDescription>}
            {prompt && prompt.kind !== "rename" && prompt.kind !== "file" && prompt.kind !== "dir" && <DialogDescription>Creates {newResource(prompt.kind, promptValue || "name").path} from a starter template.</DialogDescription>}
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPrompt();
            }}
            className="space-y-4"
          >
            <Input autoFocus aria-label="Name" value={promptValue} onChange={(e) => setPromptValue(e.target.value)} placeholder={prompt?.kind === "file" ? "e.g. notes.md or skills/x/SKILL.md" : prompt && prompt.kind !== "rename" && prompt.kind !== "dir" ? NEW_KINDS.find((k) => k.kind === prompt.kind)?.placeholder : "name"} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPrompt(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!promptValue.trim()}>
                {prompt?.kind === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.path}?</AlertDialogTitle>
            <AlertDialogDescription>{deleting?.isDir ? "Every file in this folder is removed." : "The file is removed."} Nothing changes until you save.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => (removePath(deleting!.path, deleting!.isDir), setDeleting(null))}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{p.repo ? "Open a pull request" : "Save changes"}</DialogTitle>
            <DialogDescription>{p.repo ? "The changed files go into one pull request on the definition repository." : "All changed files are validated and applied together as one commit."}</DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2 font-mono text-xs">
            {changes.map((c) => (
              <li key={c.path} className="flex items-center gap-2">
                <span className={cn("w-4 text-center font-bold", c.content === null ? "text-red-600" : c.path in base ? "text-amber-600" : "text-emerald-600")}>{c.content === null ? "D" : c.path in base ? "M" : "A"}</span>
                {c.path}
              </li>
            ))}
          </ul>
          {errors > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="size-4" /> {errors} problem{errors === 1 ? "" : "s"} found; the save will be rejected until they are fixed.
            </p>
          )}
          <Input aria-label="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Update factory definition" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaving(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : p.repo ? "Open pull request" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function uniqueCopy(path: string, files: Record<string, string>): string {
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > path.lastIndexOf("/") ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  let candidate = `${stem}-copy${ext}`;
  for (let i = 2; candidate in files; i++) candidate = `${stem}-copy-${i}${ext}`;
  return candidate;
}

function Row({ depth, active, onClick, icon, label, menu, tone, changed }: { depth: number; active?: boolean; onClick: () => void; icon: React.ReactNode; label: string; menu?: React.ReactNode; tone?: "error" | "warning"; changed?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn("group/row flex h-8 items-center gap-1.5 rounded-md pr-1 text-sm", active ? "bg-muted font-medium outline outline-1 -outline-offset-1 outline-violet-500/60" : "hover:bg-muted/50")}
      style={{ paddingLeft: 4 + depth * 14 }}
      onContextMenu={(e) => {
        if (!menu) return;
        e.preventDefault();
        setOpen(true);
      }}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        {icon}
        <span className={cn("truncate", tone === "error" && "text-red-600 dark:text-red-400", tone === "warning" && "text-amber-600 dark:text-amber-400")}>{label}</span>
        {changed && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-label="modified" />}
      </button>
      {menu && (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${label}`} className="opacity-0 group-hover/row:opacity-100 aria-expanded:opacity-100 focus-visible:opacity-100" />}>
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {menu}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Drag handle on the tree's right edge (200–480px). */
function ResizeHandle({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file tree"
      aria-valuenow={width}
      aria-valuemin={200}
      aria-valuemax={480}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(Math.max(200, width - 16));
        if (e.key === "ArrowRight") onChange(Math.min(480, width + 16));
      }}
      onPointerDown={(e) => {
        const startX = e.clientX;
        const startW = width;
        const move = (ev: PointerEvent) => onChange(Math.min(480, Math.max(200, startW + ev.clientX - startX)));
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      className="absolute top-0 -right-1 h-full w-2 cursor-col-resize hover:bg-violet-500/20 focus-visible:bg-violet-500/30 focus-visible:outline-none"
    />
  );
}
