"use client";

import { FileIcon, ImageIcon, Loader2, VideoIcon, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type UploadedAttachment = { key: string; name: string; contentType: string; size: number };
type Pending = { id: string; name: string; contentType: string; size: number; status: "uploading" | "done" | "error"; result?: UploadedAttachment };

/** Uploads each chosen file through /api/uploads (which forwards to POST /api/v1/uploads). */
export function useAttachments() {
  const [items, setItems] = useState<Pending[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    const pending = list.map((f) => ({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, name: f.name, contentType: f.type || "application/octet-stream", size: f.size, status: "uploading" as const }));
    setItems((prev) => [...prev, ...pending]);
    await Promise.all(
      list.map(async (file, i) => {
        const id = pending[i]!.id;
        const body = new FormData();
        body.set("file", file, file.name);
        try {
          const res = await fetch("/api/uploads", { method: "POST", body });
          const data = (await res.json().catch(() => ({}))) as Partial<UploadedAttachment> & { error?: string };
          if (!res.ok || !data.key) throw new Error(data.error ?? `Upload failed (${res.status})`);
          setItems((prev) => prev.map((p) => (p.id === id ? { ...p, status: "done", result: data as UploadedAttachment } : p)));
        } catch (err) {
          setItems((prev) => prev.filter((p) => p.id !== id));
          toast.error(`Could not attach ${file.name}`, { description: err instanceof Error ? err.message : undefined });
        }
      }),
    );
  }, []);

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((p) => p.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);
  const open = useCallback(() => inputRef.current?.click(), []);

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      hidden
      onChange={(e) => {
        if (e.target.files?.length) void add(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return {
    items,
    input,
    open,
    add,
    remove,
    clear,
    uploading: items.some((i) => i.status === "uploading"),
    attachments: items.filter((i) => i.status === "done" && i.result).map((i) => i.result!),
  };
}

function kindIcon(contentType: string) {
  if (contentType.startsWith("image/")) return ImageIcon;
  if (contentType.startsWith("video/")) return VideoIcon;
  return FileIcon;
}

export function AttachmentChips({ items, onRemove, className }: { items: Pending[]; onRemove: (id: string) => void; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((a) => {
        const Icon = kindIcon(a.contentType);
        return (
          <li key={a.id} className="flex h-7 max-w-60 items-center gap-1.5 rounded-md border bg-muted/50 pr-1 pl-2 text-xs">
            {a.status === "uploading" ? <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> : <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">{a.name}</span>
            <button type="button" aria-label={`Remove ${a.name}`} onClick={() => onRemove(a.id)} className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Attachments shown on a sent message. */
export function SentAttachments({ attachments, align = "start" }: { attachments: UploadedAttachment[]; align?: "start" | "end" }) {
  if (!attachments.length) return null;
  return (
    <ul className={cn("mt-1.5 flex flex-wrap gap-1.5", align === "end" && "justify-end")}>
      {attachments.map((a) => {
        const Icon = kindIcon(a.contentType);
        const href = `/files/${a.key}`;
        return (
          <li key={a.key}>
            {a.contentType.startsWith("image/") ? (
              <a href={href} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={href} alt={a.name} className="h-20 w-auto max-w-40 object-cover" />
              </a>
            ) : (
              <a href={href} download={a.name} className="flex h-7 items-center gap-1.5 rounded-md border bg-muted/50 px-2 text-xs hover:bg-muted">
                <Icon className="size-3.5 text-muted-foreground" />
                {a.name}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
