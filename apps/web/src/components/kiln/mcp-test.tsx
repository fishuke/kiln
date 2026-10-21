"use client";

import { useState, useTransition } from "react";
import { CircleCheck, CircleDashed, CircleX, FlaskConical, X } from "lucide-react";
import type { McpTestResult } from "@kiln/sdk-ts";
import { testMcps } from "@/app/mcps/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const ICON = { ok: CircleCheck, error: CircleX, untested: CircleDashed };
const TONE = { ok: "text-green-600 dark:text-green-400", error: "text-destructive", untested: "text-muted-foreground" };

/**
 * Tests MCP servers and shows what each one answered. The same button serves every scope:
 * the team's servers, a factory's agents, one agent, or just the named servers.
 */
export function McpTestButton({ scope, label = "Test", title = "MCP test", variant = "ghost", disabled }: { scope: { factory?: string; agent?: string; servers?: string[] }; label?: string; title?: string; variant?: "ghost" | "outline"; disabled?: boolean }) {
  const [results, setResults] = useState<McpTestResult[]>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await testMcps(scope);
      setError(r.ok ? undefined : r.error);
      setResults(r.ok ? (r.data ?? []) : []);
    });
  const open = results !== undefined;
  return (
    <>
      <Button type="button" variant={variant} onClick={run} disabled={disabled || pending || scope.servers?.length === 0}>
        <FlaskConical /> {pending ? "Testing…" : label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setResults(undefined)}>
        <DialogContent showCloseButton={false} className="gap-0 p-0 sm:max-w-[560px]">
          <div className="flex items-center gap-2 border-b px-5 py-3">
            <DialogTitle className="flex-1 text-base font-semibold">{title}</DialogTitle>
            <Button variant="outline" size="sm" onClick={run} disabled={pending}>
              {pending ? "Testing…" : "Test again"}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setResults(undefined)}>
              <X />
            </Button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {error && <p className="px-5 py-4 text-sm text-destructive">{error}</p>}
            {!error && results?.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No MCP servers to test.</p>}
            <ul className="divide-y">
              {results?.map((r) => {
                const I = ICON[r.status];
                return (
                  <li key={r.name} className="flex gap-3 px-5 py-3">
                    <I className={`mt-0.5 size-4 shrink-0 ${TONE[r.status]}`} />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-mono font-medium">{r.name}</div>
                      <div className="text-muted-foreground">{r.message}</div>
                      {r.tools && r.tools.length > 0 && <div className="mt-1 truncate font-mono text-xs text-muted-foreground" title={r.tools.join(", ")}>{r.tools.join(", ")}</div>}
                      {r.agents && r.agents.length > 0 && <div className="mt-1 text-xs text-muted-foreground">Used by {r.agents.join(", ")}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
