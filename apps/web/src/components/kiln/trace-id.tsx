"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** A trace id, short, with a button that copies all of it: what to search for in the tracing backend. */
export function TraceId({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="mt-1 flex items-center gap-1 font-mono text-xs text-muted-foreground">
      <span title={traceId}>Trace {traceId.slice(0, 8)}…</span>
      <button
        type="button"
        aria-label="Copy trace ID"
        title="Copy trace ID"
        className="inline-flex size-5 items-center justify-center rounded hover:bg-muted hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard?.writeText(traceId).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </span>
  );
}
