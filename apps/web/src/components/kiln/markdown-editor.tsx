"use client";

import { useRef, useState } from "react";
import { Bold, Code, Eye, Italic, Link as LinkIcon, List, ListOrdered, Pencil, Strikethrough, TextQuote, Underline } from "lucide-react";
import { Markdown } from "@/components/kiln/markdown";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Edit = { text: string; start: number; end: number };

/** Wraps the selection (or inserts a placeholder) with `before`/`after`. */
export function wrapSelection(e: Edit, before: string, after = before, placeholder = "text"): Edit {
  const sel = e.text.slice(e.start, e.end) || placeholder;
  const text = e.text.slice(0, e.start) + before + sel + after + e.text.slice(e.end);
  return { text, start: e.start + before.length, end: e.start + before.length + sel.length };
}

/** Prefixes every selected line (e.g. "- ", "1. ", "> ", "## "), replacing an existing heading prefix. */
export function prefixLines(e: Edit, prefix: (i: number) => string, stripHeading = false): Edit {
  const lineStart = e.text.lastIndexOf("\n", e.start - 1) + 1;
  const nextNl = e.text.indexOf("\n", e.end);
  const lineEnd = nextNl === -1 ? e.text.length : nextNl;
  const block = e.text.slice(lineStart, lineEnd);
  const out = block
    .split("\n")
    .map((l, i) => prefix(i) + (stripHeading ? l.replace(/^#{1,6}\s+/, "") : l))
    .join("\n");
  return { text: e.text.slice(0, lineStart) + out + e.text.slice(lineEnd), start: lineStart, end: lineStart + out.length };
}

const STYLES = { p: "Paragraph", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3" };

function currentStyle(text: string, pos: number): keyof typeof STYLES {
  const line = text.slice(text.lastIndexOf("\n", pos - 1) + 1).split("\n")[0] ?? "";
  const m = /^(#{1,3})\s/.exec(line);
  return m ? (`h${m[1]!.length}` as keyof typeof STYLES) : "p";
}

/** Markdown editor card: style dropdown + formatting toolbar, Write / Preview (rendered with <Markdown>). */
export function MarkdownEditor({ value, onChange, disabled, minRows = 18, placeholder }: { value: string; onChange: (v: string) => void; disabled?: boolean; minRows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(!!disabled);
  const [style, setStyle] = useState<keyof typeof STYLES>("p");
  const apply = (fn: (e: Edit) => Edit) => {
    const ta = ref.current;
    if (!ta || disabled) return;
    const next = fn({ text: value, start: ta.selectionStart, end: ta.selectionEnd });
    onChange(next.text);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(next.start, next.end);
    });
  };
  const tool = (label: string, Icon: React.ComponentType<{ className?: string }>, fn: (e: Edit) => Edit) => (
    <button type="button" aria-label={label} title={label} disabled={disabled || preview} onClick={() => apply(fn)} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
      <Icon className="size-4" />
    </button>
  );
  const sep = <span className="mx-1 h-5 w-px bg-border" />;
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex min-h-14 flex-wrap items-center gap-0.5 border-b px-2 py-2">
        <Select
          items={STYLES}
          value={style}
          disabled={disabled || preview}
          onValueChange={(v) => {
            const s = v as keyof typeof STYLES;
            setStyle(s);
            apply((e) => prefixLines(e, () => (s === "p" ? "" : `${"#".repeat(Number(s.slice(1)))} `), true));
          }}
        >
          <SelectTrigger className="h-8 w-32 border-none text-muted-foreground shadow-none" aria-label="Text style">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(STYLES).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sep}
        {tool("Bold", Bold, (e) => wrapSelection(e, "**"))}
        {tool("Italic", Italic, (e) => wrapSelection(e, "_"))}
        {tool("Underline", Underline, (e) => wrapSelection(e, "<u>", "</u>"))}
        {tool("Strikethrough", Strikethrough, (e) => wrapSelection(e, "~~"))}
        {sep}
        {tool("Link", LinkIcon, (e) => wrapSelection(e, "[", "](https://)", "link text"))}
        {sep}
        {tool("Ordered list", ListOrdered, (e) => prefixLines(e, (i) => `${i + 1}. `))}
        {tool("Bullet list", List, (e) => prefixLines(e, () => "- "))}
        {sep}
        {tool("Blockquote", TextQuote, (e) => prefixLines(e, () => "> "))}
        {tool("Code", Code, (e) => (e.text.slice(e.start, e.end).includes("\n") ? wrapSelection(e, "```\n", "\n```", "code") : wrapSelection(e, "`")))}
        <div className="ml-auto flex rounded-md border p-0.5 text-xs">
          <button type="button" onClick={() => setPreview(false)} className={cn("flex items-center gap-1 rounded px-2 py-1", !preview ? "bg-muted font-medium" : "text-muted-foreground")}>
            <Pencil className="size-3" /> Write
          </button>
          <button type="button" onClick={() => setPreview(true)} className={cn("flex items-center gap-1 rounded px-2 py-1", preview ? "bg-muted font-medium" : "text-muted-foreground")}>
            <Eye className="size-3" /> Preview
          </button>
        </div>
      </div>
      {preview ? (
        <div className="min-h-80 px-4 py-3">{value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-muted-foreground">Nothing to preview.</p>}</div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onSelect={(e) => setStyle(currentStyle(value, e.currentTarget.selectionStart))}
          rows={Math.max(minRows, value.split("\n").length + 2)}
          placeholder={placeholder}
          spellCheck
          className="block w-full resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
        />
      )}
    </div>
  );
}
