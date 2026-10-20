"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Container, ExternalLink, Plus, Trash, X } from "lucide-react";
import { toast } from "sonner";
import { saveRunner, type RunnerInput } from "@/app/f/[factory]/settings/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SecretOption } from "./resource-pickers";

export type RunnerFile = { description?: string; image?: string; platform?: { os?: RunnerInput["os"]; linux?: { dockerImage?: string; registryCredentialSecretName?: string } }; registryCredentialSecretName?: string; setupCommands?: string[]; failureSessionRetentionMinutes?: number; shape?: { vcpus: number; memoryGb: number } };

const VCPUS = [1, 2, 4, 8, 16, 32];
const MEMORY = [1, 2, 4, 8, 16, 32, 64];
const DEFAULT_IMAGE = "node:22-bookworm";
const OS_ITEMS = { linux: "Linux", macos: "macOS", windows: "Windows" };

function Stepper({ label, values, unit, value, onChange }: { label: string; values: number[]; unit: (n: number) => string; value: number | undefined; onChange: (n: number) => void }) {
  const idx = Math.max(0, values.indexOf(value ?? values[1]!));
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <input type="range" min={0} max={values.length - 1} step={1} value={idx} onChange={(e) => onChange(values[Number(e.target.value)]!)} className="w-full accent-foreground" aria-label={label} aria-valuetext={unit(values[idx]!)} />
      <div className="flex justify-between text-xs text-muted-foreground">
        {values.map((v) => (
          <span key={v} className={cn(v === values[idx] && "font-medium text-foreground")}>
            {unit(v)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Edit runner / New runner dialog (writes runners/<name>.yaml). */
export function RunnerDialog({ factory, open, onOpenChange, name, runner, isDefault, secrets, onSaved, readOnly }: { factory: string; open: boolean; onOpenChange: (o: boolean) => void; name?: string; runner?: RunnerFile; isDefault?: boolean; secrets: SecretOption[]; onSaved?: (name: string) => void; readOnly?: boolean }) {
  const isNew = !name;
  const initial = (): RunnerInput => ({
    name: name ?? "",
    description: runner?.description ?? "",
    os: runner?.platform?.os ?? "linux",
    image: runner?.image ?? (isNew ? "" : DEFAULT_IMAGE),
    registryCredentialSecretName: runner?.registryCredentialSecretName ?? runner?.platform?.linux?.registryCredentialSecretName ?? "",
    setupCommands: runner?.setupCommands?.length ? runner.setupCommands : isNew ? [""] : [],
    keepSessionAfterFailure: !!runner?.failureSessionRetentionMinutes,
    vcpus: runner?.shape?.vcpus,
    memoryGb: runner?.shape?.memoryGb,
    makeDefault: false,
  });
  const [form, setForm] = useState<RunnerInput>(initial);
  const [pending, start] = useTransition();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(initial()), [open, name]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial());
  const set = (p: Partial<RunnerInput>) => setForm((f) => ({ ...f, ...p }));
  const submit = () =>
    start(async () => {
      if (!form.image.trim() && form.os === "linux") {
        toast.error("Enter a Docker image.");
        return;
      }
      const r = await saveRunner(factory, form, isNew);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.pullRequest) toast.success("Pull request opened", { action: { label: "View", onClick: () => window.open(r.pullRequest, "_blank") } });
      else toast.success(isNew ? `Runner ${form.name} created` : "Runner saved");
      onSaved?.(form.name.trim());
      onOpenChange(false);
    });
  const imageCreds = { "": "None (public image)", ...Object.fromEntries(secrets.map((s) => [s.name, s.name])) };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex! max-h-[min(640px,90vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]" showCloseButton={false}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <DialogTitle className="text-base font-semibold">{isNew ? "New runner" : "Edit runner"}</DialogTitle>
          <Button variant="ghost" size="icon-sm" aria-label="Close runner editor" onClick={() => onOpenChange(false)}>
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
        <fieldset disabled={readOnly} className="min-w-0 space-y-5 px-6 pb-6">
          <p className="text-sm text-muted-foreground">Runners are the machines that your factory uses for compute. Configure the operating system, machine size, and commands that prepare each agent workspace.</p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="runner-name">
              Name <span className="text-red-600">*</span>
            </label>
            <Input id="runner-name" value={form.name} disabled={!isNew} onChange={(e) => set({ name: e.target.value.toLowerCase() })} placeholder="e.g. macos-release" className="h-10" />
            <p className="text-xs text-muted-foreground">Runner names cannot be changed after creation.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="runner-desc">
              Description
            </label>
            <Textarea id="runner-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Optional description for this runner" />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-medium">Operating system</div>
            <Select items={OS_ITEMS} value={form.os} onValueChange={(v) => set({ os: v as RunnerInput["os"] })} disabled={isDefault || readOnly}>
              <SelectTrigger className="h-10 w-full" aria-label="Operating system">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OS_ITEMS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isDefault && <p className="text-xs text-muted-foreground">The default runner must remain Linux.</p>}
            {form.os !== "linux" && <p className="text-xs text-muted-foreground">macOS and Windows runners need a self-hosted worker on that OS.</p>}
          </div>
          {form.os === "linux" && (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="runner-image">
                  Docker image <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <Container className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="runner-image" value={form.image} onChange={(e) => set({ image: e.target.value })} placeholder={DEFAULT_IMAGE} className="h-10 pl-9 font-mono" />
                </div>
                <p className="text-xs text-muted-foreground">The container image used to set up this runner.</p>
              </div>
              <div className="space-y-1.5">
                <div className="text-sm font-medium">Private image credential</div>
                <Select items={imageCreds} value={form.registryCredentialSecretName ?? ""} onValueChange={(v) => set({ registryCredentialSecretName: String(v ?? "") })}>
                  <SelectTrigger className="h-10 w-full" aria-label="Private image credential">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(imageCreds).map(([k, v]) => (
                      <SelectItem key={k || "none"} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Needed only for private images. Credentials are shared across the team.</p>
              </div>
            </>
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Setup commands</div>
              <Button variant="outline" size="icon-sm" aria-label="Add setup command" onClick={() => set({ setupCommands: [...form.setupCommands, ""] })}>
                <Plus />
              </Button>
            </div>
            {form.setupCommands.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={c}
                  aria-label={`Setup command ${i + 1}`}
                  onChange={(e) => set({ setupCommands: form.setupCommands.map((x, j) => (j === i ? e.target.value : x)) })}
                  placeholder="cd my-repo && npm install"
                  className="h-10 font-mono text-xs"
                />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove setup command ${i + 1}`} onClick={() => set({ setupCommands: form.setupCommands.filter((_, j) => j !== i) })}>
                  <Trash />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Each setup command runs independently, in the workspace root (/workspace).</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.keepSessionAfterFailure} onCheckedChange={(c) => set({ keepSessionAfterFailure: !!c })} />
            Keep session after failure
          </label>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{form.vcpus ? "Machine size for every run on this runner." : "Uses the worker's default machine size until you choose one."}</p>
            <Stepper label="vCPUs" values={VCPUS} unit={(n) => `${n} vCPU${n > 1 ? "s" : ""}`} value={form.vcpus} onChange={(n) => set({ vcpus: n, memoryGb: form.memoryGb ?? 4 })} />
            <Stepper label="Memory" values={MEMORY} unit={(n) => `${n} GB`} value={form.memoryGb} onChange={(n) => set({ memoryGb: n, vcpus: form.vcpus ?? 2 })} />
          </div>
          {isNew && (
            <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <span>
                <span className="block text-sm font-medium">Make default</span>
                <span className="block text-xs text-muted-foreground">This runner will be assigned to newly created agents by default.</span>
              </span>
              <Switch checked={!!form.makeDefault} onCheckedChange={(c) => set({ makeDefault: c })} />
            </label>
          )}
        </fieldset>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" render={<Link href={`/f/${factory}/definition?file=${encodeURIComponent(`runners/${form.name || "new-runner"}.yaml`)}`} />} nativeButton={false}>
            {isNew ? "Create via file" : "Edit runner file"} <ExternalLink />
          </Button>
          <Button onClick={submit} disabled={readOnly || pending || (!isNew && !dirty) || (isNew && !form.name)} variant={isNew ? "default" : dirty ? "default" : "secondary"}>
            {isNew ? "Create runner" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
