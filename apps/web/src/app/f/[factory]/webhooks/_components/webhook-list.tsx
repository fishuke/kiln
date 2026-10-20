"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, Webhook as WebhookIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { timeAgo } from "@/lib/format";
import { authLabel } from "@/lib/webhook-files";
import { setWebhookEnabled } from "../actions";

export type WebhookRow = { uid: string; name: string; authMode: string; signatureScheme?: string; enabled: boolean; url: string; source: "api" | "file"; lastDeliveryAt?: string; automations: number };

export function WebhookSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(Boolean(value));
  return open ? (
    <input autoFocus aria-label="Search webhooks" value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => !value && setOpen(false)} placeholder="Search webhooks…" className="h-8 w-56 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
  ) : (
    <Button variant="outline" size="icon" aria-label="Search webhooks" onClick={() => setOpen(true)}>
      <Search />
    </Button>
  );
}

export function WebhookList({ factory, rows, addButton }: { factory: string; rows: WebhookRow[]; addButton: React.ReactNode }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const shown = rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  if (!rows.length) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <WebhookIcon className="mb-3 size-9 text-muted-foreground" strokeWidth={1.5} />
        <p className="font-semibold">No webhooks yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Webhooks let external systems trigger automations by posting JSON to a Kiln-hosted URL.</p>
        <div className="mt-4">{addButton}</div>
      </div>
    );
  }
  return (
    <>
      <div className="mb-3 flex justify-end">
        <WebhookSearch value={q} onChange={setQ} />
      </div>
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-normal">Webhook</th>
              <th className="px-4 py-3 font-normal">Authentication</th>
              <th className="px-4 py-3 font-normal">Automations</th>
              <th className="px-4 py-3 font-normal">Last delivery</th>
              <th className="w-24 px-4 py-3 font-normal">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((w) => {
              const enabled = optimistic[w.uid] ?? w.enabled;
              return (
                <tr key={w.uid} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <Link href={`/f/${factory}/webhooks/${encodeURIComponent(w.uid)}`} className="font-medium hover:underline">
                      {w.name}
                    </Link>
                    <div className="truncate font-mono text-xs text-muted-foreground">{w.source === "file" ? `webhooks/${w.name}.yaml` : w.url}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{authLabel(w.authMode, w.signatureScheme)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{w.automations || "None"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{w.lastDeliveryAt ? timeAgo(w.lastDeliveryAt) : "—"}</td>
                  <td className="px-4 py-3">
                    <Switch
                      aria-label={`${w.name} enabled`}
                      checked={enabled}
                      disabled={pending || w.source === "file"}
                      onCheckedChange={(v) => {
                        setOptimistic((o) => ({ ...o, [w.uid]: v }));
                        start(async () => {
                          const r = await setWebhookEnabled(factory, w.uid, v);
                          if (!r.ok) {
                            toast.error(r.error);
                            setOptimistic((o) => ({ ...o, [w.uid]: !v }));
                          } else toast.success(v ? "Webhook enabled" : "Webhook disabled");
                          router.refresh();
                        });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
