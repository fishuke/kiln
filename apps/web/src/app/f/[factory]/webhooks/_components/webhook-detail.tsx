"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { AlertTriangle, ChevronRight, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/components/kiln/form-controls";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Delivery } from "@/lib/api/webhooks";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { authLabel } from "@/lib/webhook-files";
import { removeWebhook, rotateWebhookSecret, setWebhookEnabled } from "../actions";
import { UrlBox } from "./add-webhook";

const STATUS: Record<string, { label: string; tone: string }> = {
  accepted: { label: "Accepted", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400" },
  duplicate: { label: "Duplicate", tone: "bg-muted text-muted-foreground" },
  rejected_auth: { label: "Rejected (auth)", tone: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400" },
  rejected_invalid_json: { label: "Rejected (invalid JSON)", tone: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400" },
  rejected_too_large: { label: "Rejected (too large)", tone: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400" },
};

function size(n?: number) {
  if (n === undefined) return "—";
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

export type WebhookView = { uid: string; name: string; authMode: string; signatureScheme?: string; secretName?: string; deliveryIdHeader?: string; enabled: boolean; url: string; source: "api" | "file" };

export function WebhookDetail({ factory, webhook, deliveries, automations }: { factory: string; webhook: WebhookView; deliveries: Delivery[]; automations: { name: string; title: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(webhook.enabled);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const file = webhook.source === "file";
  const rows: [string, React.ReactNode][] = [
    ["Authentication", authLabel(webhook.authMode, webhook.signatureScheme)],
    ["Secret name", webhook.secretName ? <code className="font-mono text-xs">{webhook.secretName}</code> : "—"],
    ["Delivery ID header", webhook.deliveryIdHeader ? <code className="font-mono text-xs">{webhook.deliveryIdHeader}</code> : "—"],
    ["Webhook id", <code key="id" className="font-mono text-xs">{webhook.uid}</code>],
  ];
  return (
    <div className="mx-auto w-full max-w-[820px] space-y-8 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{webhook.name}</h1>
          {file && <p className="mt-1 text-sm text-muted-foreground">Defined in webhooks/{webhook.uid}.yaml. Edit it in the factory definition.</p>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            aria-label="Enabled"
            checked={enabled}
            disabled={pending || file}
            onCheckedChange={(v) => {
              setEnabled(v);
              start(async () => {
                const r = await setWebhookEnabled(factory, webhook.uid, v);
                if (!r.ok) {
                  setEnabled(!v);
                  toast.error(r.error);
                } else toast.success(v ? "Webhook enabled" : "Webhook disabled: deliveries now get 404");
                router.refresh();
              });
            }}
          />
          Enabled
        </label>
      </div>

      {!file && <UrlBox url={webhook.url} />}
      {secret && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">New secret</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">{secret}</code>
            <CopyButton value={secret} />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5" /> Shown once. The old secret stopped working immediately.
          </p>
        </div>
      )}

      <dl className="divide-y rounded-xl border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h2 className="mb-2 text-sm text-muted-foreground">Automations</h2>
        {automations.length ? (
          <ul className="divide-y rounded-xl border">
            {automations.map((a) => (
              <li key={a.name}>
                <Link href={`/f/${factory}/automations/${encodeURIComponent(a.name)}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/40">
                  {a.title} <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No automation subscribes to this webhook, so deliveries start nothing.{" "}
            <Link href={`/f/${factory}/automations/new`} className="font-medium text-foreground underline">
              Create automation
            </Link>
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm text-muted-foreground">Recent deliveries</h2>
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="w-8 px-2 py-3" />
                <th className="px-2 py-3 font-normal">Status</th>
                <th className="px-4 py-3 font-normal">Delivery ID</th>
                <th className="px-4 py-3 font-normal">Size</th>
                <th className="px-4 py-3 text-right font-normal">Received</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => {
                const s = STATUS[d.status] ?? { label: d.status, tone: "bg-muted" };
                const canExpand = d.status === "accepted" && d.payload !== undefined;
                const open = openRow === d.id;
                return (
                  <Fragment key={d.id}>
                    <tr className={cn("border-b last:border-0", canExpand && "cursor-pointer hover:bg-muted/40")} onClick={() => canExpand && setOpenRow(open ? null : d.id)}>
                      <td className="px-2 py-3 text-muted-foreground">{canExpand && <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />}</td>
                      <td className="px-2 py-3">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", s.tone)}>{s.label}</span>
                      </td>
                      <td className="max-w-60 truncate px-4 py-3 font-mono text-xs">{d.deliveryId ?? d.id}</td>
                      <td className="px-4 py-3 text-muted-foreground">{size(d.size)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{timeAgo(d.receivedAt)}</td>
                    </tr>
                    {open && (
                      <tr className="border-b bg-muted/30">
                        <td colSpan={5} className="px-4 py-3">
                          <pre className="max-h-96 overflow-auto rounded-lg bg-background p-3 font-mono text-xs">{JSON.stringify(d.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!deliveries.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    No deliveries yet. Kiln keeps at least the last 50 deliveries and 7 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {!file && (
        <section className="flex flex-wrap gap-2 border-t pt-6">
          {webhook.authMode !== "signature" && (
            <Button variant="outline" onClick={() => setConfirm("rotate")} disabled={pending}>
              <RotateCw /> Rotate secret
            </Button>
          )}
          <Button variant="destructive" onClick={() => setConfirm("delete")} disabled={pending}>
            <Trash2 /> Delete webhook
          </Button>
        </section>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "rotate" ? "Rotate the secret?" : `Delete ${webhook.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "rotate"
                ? "The current secret stops working immediately; there is no overlap. For zero downtime, create a second webhook and switch the sender first."
                : "Deliveries to this URL get 404. Automations that subscribe to it stay but stop firing."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "delete" ? "destructive" : "default"}
              onClick={() => {
                const what = confirm;
                setConfirm(null);
                start(async () => {
                  if (what === "rotate") {
                    const r = await rotateWebhookSecret(factory, webhook.uid);
                    if (!r.ok) return void toast.error(r.error);
                    setSecret(r.secret ?? null);
                    toast.success("Secret rotated");
                    router.refresh();
                  } else {
                    const r = await removeWebhook(factory, webhook.uid, file);
                    if (!r.ok) return void toast.error(r.error);
                    toast.success("Webhook deleted");
                    router.push(`/f/${factory}/webhooks`);
                  }
                });
              }}
            >
              {confirm === "rotate" ? "Rotate" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
