"use client";

import { useEffect, useRef, useState } from "react";
import Editor, { loader, type Monaco, type OnMount } from "@monaco-editor/react";

// Served by src/app/monaco/[...path]/route.ts from node_modules (no CDN needed when self-hosting).
loader.config({ paths: { vs: "/monaco/vs" } });

export type EditorMarker = { line: number; message: string; severity: "error" | "warning" };

function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.classList.contains("dark"));
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function defineThemes(monaco: Monaco) {
  monaco.editor.defineTheme("kiln-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "type.yaml", foreground: "0f766e" },
      { token: "string.yaml", foreground: "1d4ed8" },
      { token: "keyword.md", foreground: "1d4ed8", fontStyle: "bold" },
    ],
    colors: { "editor.background": "#fcfcfb", "editorLineNumber.foreground": "#2563eb99", "editorLineNumber.activeForeground": "#1d4ed8" },
  });
  monaco.editor.defineTheme("kiln-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "type.yaml", foreground: "5eead4" },
      { token: "string.yaml", foreground: "93c5fd" },
    ],
    colors: { "editor.background": "#1c1c1c", "editorLineNumber.foreground": "#60a5fa88" },
  });
}

/** Monaco with Kiln's light/dark themes, per-file models (keeps undo history) and validation markers. */
export function CodeEditor({
  path,
  value,
  language,
  onChange,
  readOnly,
  markers = [],
  revealLine,
}: {
  path: string;
  value: string;
  language: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  markers?: EditorMarker[];
  revealLine?: { line: number; nonce: number };
}) {
  const dark = useDarkMode();
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      "kiln",
      markers.map((m) => ({
        startLineNumber: Math.max(1, m.line),
        endLineNumber: Math.max(1, m.line),
        startColumn: 1,
        endColumn: model.getLineMaxColumn(Math.min(Math.max(1, m.line), model.getLineCount())),
        message: m.message,
        severity: m.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      })),
    );
  }, [markers, path, ready]);

  useEffect(() => {
    if (!revealLine || !editorRef.current) return;
    editorRef.current.revealLineInCenter(revealLine.line);
    editorRef.current.setPosition({ lineNumber: revealLine.line, column: 1 });
    editorRef.current.focus();
  }, [revealLine]);

  return (
    <Editor
      path={path}
      value={value}
      language={language}
      theme={dark ? "kiln-dark" : "kiln-light"}
      beforeMount={defineThemes}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        setReady(true);
      }}
      onChange={(v) => onChange(v ?? "")}
      loading={<div className="p-4 text-sm text-muted-foreground">Loading editor…</div>}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        wordWrap: language === "markdown" ? "on" : "off",
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 8 },
        guides: { indentation: true },
      }}
    />
  );
}
