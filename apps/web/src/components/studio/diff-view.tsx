"use client";

import { ChevronRight, FileCode, FileMinus, FilePlus, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { fileTree, splitDiff, type DiffFile, type FileNode } from "@/lib/studio/model";
import { cn } from "@/lib/utils";

const STATUS_ICON = { added: FilePlus, deleted: FileMinus, modified: FileCode } as const;

/** The File Tree pattern over the changed files. */
function TreeNode({ node, files, selected, onSelect }: { node: FileNode; files: Map<string, DiffFile>; selected: string; onSelect: (p: string) => void }) {
  if (node.type === "folder")
    return (
      <Collapsible defaultOpen>
        <CollapsibleTrigger
          render={<Button variant="ghost" size="sm" className="w-full justify-start font-normal aria-expanded:bg-transparent aria-expanded:hover:bg-muted" />}
        >
          <ChevronRight className="transition-transform group-data-panel-open/button:rotate-90" />
          <Folder className="text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-3.5 flex flex-col border-l pl-1">
            {node.children.map((c) => (
              <TreeNode key={c.path} node={c} files={files} selected={selected} onSelect={onSelect} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  const f = files.get(node.path);
  const Icon = STATUS_ICON[f?.status ?? "modified"];
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-current={selected === node.path ? "true" : undefined}
      onClick={() => onSelect(node.path)}
      className={cn("w-full justify-start font-normal", selected === node.path && "bg-muted text-foreground")}
    >
      <Icon
        className={cn(
          f?.status === "added" ? "text-emerald-600 dark:text-emerald-400" : f?.status === "deleted" ? "text-destructive" : "text-muted-foreground",
        )}
      />
      <span className="truncate">{node.name}</span>
      {f && (
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
        </span>
      )}
    </Button>
  );
}

/** One file's diff in a Code Block with added and removed lines. */
function FileDiff({ file }: { file: DiffFile }) {
  const raw = file.lines.map((l) => (l.kind === "add" ? `+${l.text}` : l.kind === "del" ? `-${l.text}` : l.kind === "hunk" ? l.text : ` ${l.text}`)).join("\n");
  return (
    <CodeBlock size="sm" className="min-h-0 flex-1">
      <CodeBlockHeader>
        <CodeBlockTitle className="font-mono">{file.path}</CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton value={raw} />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent className="min-h-0 flex-1 text-xs">
        {file.lines.map((l, i) =>
          l.kind === "hunk" ? (
            <CodeBlockLine key={i} className="text-muted-foreground">
              {l.text}
            </CodeBlockLine>
          ) : (
            <CodeBlockLine
              key={i}
              variant={l.kind === "add" ? "added" : l.kind === "del" ? "removed" : "default"}
              className={l.kind === "add" ? "bg-emerald-500/10" : undefined}
            >
              {l.text}
            </CodeBlockLine>
          ),
        )}
      </CodeBlockContent>
    </CodeBlock>
  );
}

/** Details of a change: the File Tree on the left, the selected file's diff on the right. */
export function DiffView({ diff, className }: { diff: string | undefined; className?: string }) {
  const files = useMemo(() => splitDiff(diff ?? ""), [diff]);
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f])), [files]);
  const tree = useMemo(() => fileTree(files.map((f) => f.path)), [files]);
  const [selected, setSelected] = useState<string>();
  const current = (selected && byPath.get(selected)) || files[0];

  if (diff === undefined)
    return (
      <div className={cn("flex gap-4 p-4", className)}>
        <div className="flex w-56 flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6" />
          ))}
        </div>
        <Skeleton className="flex-1" />
      </div>
    );
  if (!files.length)
    return <div className={cn("flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground", className)}>No changes since the last version.</div>;
  return (
    <div className={cn("flex min-h-0 flex-col gap-3 md:flex-row", className)}>
      <nav aria-label="Changed files" className="flex shrink-0 flex-col overflow-y-auto md:w-60">
        <div className="px-2 pb-1 text-xs text-muted-foreground">
          {files.length} {files.length === 1 ? "file" : "files"} changed
        </div>
        {tree.map((n) => (
          <TreeNode key={n.path} node={n} files={byPath} selected={current?.path ?? ""} onSelect={setSelected} />
        ))}
      </nav>
      {current && <FileDiff file={current} />}
    </div>
  );
}
