"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { CopyButton, Field, TokenPicker } from "@/components/kiln/form-controls";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AUTH_MODES, SIGNATURE_SCHEMES } from "@/lib/webhook-files";
import { addWebhook, finishWebhookSetup, type CreatedWebhook } from "../actions";

type Mode = (typeof AUTH_MODES)[number]["value"];
type Scheme = (typeof SIGNATURE_SCHEMES)[number]["value"];

/** "Add webhook" button + dialog: settings → (Create and get URL → Finish setup) → URL and one-time secret. */
export function AddWebhook({ factory, secrets, origin, label = "Add webhook", variant = "default" }: { factory: string; secrets: string[]; origin: string; label?: string; variant?: "default" | "outline" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "finish" | "done">("form");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("token");
  const [scheme, setScheme] = useState<Scheme>("github");
  const [secretName, setSecretName] = useState<string[]>([]);
  const [providerSecret, setProviderSecret] = useState("");
  const [header, setHeader] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (params.get("new") === "1") setOpen(true);
  }, [params]);

  const secretAfterUrl = mode === "signature" && SIGNATURE_SCHEMES.find((s) => s.value === scheme)?.secretAfterUrl;
  const needsPastedSecret = mode === "signature" && !secretAfterUrl && scheme !== "standard_webhooks";
  const reset = () => {
    setStep("form");
    setName("");
    setMode("token");
    setScheme("github");
    setSecretName([]);
    setProviderSecret("");
    setHeader("");
    setEnabled(true);
    setCreated(null);
  };
  const close = () => {
    setOpen(false);
    setTimeout(reset, 200);
    if (params.get("new")) router.replace(`/f/${factory}/webhooks`);
  };
  const url = created?.url ?? (created?.uid ? `${origin}/webhooks/w/${created.uid}${mode === "url_token" ? "/{token}" : ""}` : "");

  const submit = () =>
    start(async () => {
      const r = await addWebhook(factory, {
        name,
        authMode: mode,
        signatureScheme: mode === "signature" ? scheme : undefined,
        secretName: secretName[0],
        secret: needsPastedSecret ? providerSecret || undefined : undefined,
        deliveryIdHeader: header.trim() || undefined,
        enabled: secretAfterUrl ? false : enabled,
      });
      if (!r.ok) return void toast.error(r.error);
      setCreated(r);
      router.refresh();
      if (r.fileBacked) {
        toast.success(r.pullRequest ? "Pull request opened with the webhook file" : "Webhook added to the factory definition");
        return close();
      }
      setStep(secretAfterUrl ? "finish" : "done");
    });

  const finish = () =>
    start(async () => {
      const r = await finishWebhookSetup(factory, created!.uid!, providerSecret);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Webhook enabled");
      router.refresh();
      setStep("done");
    });

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-[640px]">
          {step === "form" && (
            <>
              <DialogHeader>
                <DialogTitle>New webhook</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit();
                }}
              >
                <Field label="Name" required htmlFor="wh-name">
                  <Input id="wh-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Internal CI" className="h-10" />
                </Field>
                <Field label="Authentication type" help={AUTH_MODES.find((m) => m.value === mode)?.help}>
                  <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                    <SelectTrigger aria-label="Authentication type" className="h-10 w-full data-[size=default]:h-10">
                      <SelectValue>{(v: string) => AUTH_MODES.find((m) => m.value === v)?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {AUTH_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {mode === "signature" && (
                  <Field label="Provider" required help={secretAfterUrl ? "This provider issues its signing secret after you give it the URL. Create the webhook first, then paste the secret." : scheme === "standard_webhooks" ? "Leave the signing secret empty and Kiln generates one." : "Paste the signing secret from the provider."}>
                    <Select value={scheme} onValueChange={(v) => setScheme(v as Scheme)}>
                      <SelectTrigger aria-label="Provider" className="h-10 w-full data-[size=default]:h-10">
                        <SelectValue>{(v: string) => SIGNATURE_SCHEMES.find((s) => s.value === v)?.label}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {SIGNATURE_SCHEMES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {(needsPastedSecret || (mode === "signature" && scheme === "standard_webhooks")) && (
                  <Field label="Signing secret" required={needsPastedSecret} htmlFor="wh-secret">
                    <Input id="wh-secret" type="password" autoComplete="off" value={providerSecret} onChange={(e) => setProviderSecret(e.target.value)} placeholder={scheme === "standard_webhooks" ? "Leave empty to generate (whsec_…)" : "Paste the provider's signing secret"} className="h-10" />
                  </Field>
                )}
                <Field label="Secret name" required help="Choose an existing team secret to reference it, or type a name to create one for this webhook.">
                  <TokenPicker label="Secret name" single values={secretName} onChange={setSecretName} suggestions={secrets} placeholder="Search secrets or type a new name…" validate={(v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? null : "Use letters, digits and underscores")} />
                </Field>
                <Field label="Delivery ID header" help="Optional. A header this sender stamps its own delivery identity into." htmlFor="wh-header">
                  <Input id="wh-header" value={header} onChange={(e) => setHeader(e.target.value)} placeholder="e.g. X-Sender-Event-Id" className="h-10" />
                </Field>
                {!secretAfterUrl && (
                  <label className="flex items-center gap-3 text-sm">
                    <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" /> Enabled
                  </label>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={pending || !name.trim() || !secretName.length || (needsPastedSecret && !providerSecret)}>
                    {pending ? "Saving…" : secretAfterUrl ? "Create and get URL" : "Save webhook"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
          {step === "finish" && (
            <>
              <DialogHeader>
                <DialogTitle>Finish webhook setup</DialogTitle>
                <DialogDescription>Give this URL to {SIGNATURE_SCHEMES.find((s) => s.value === scheme)?.label}, then paste the signing secret it shows you. The webhook stays disabled until you finish.</DialogDescription>
              </DialogHeader>
              <UrlBox url={url} />
              <Field label="Signing secret" required htmlFor="wh-finish">
                <Input id="wh-finish" type="password" autoComplete="off" value={providerSecret} onChange={(e) => setProviderSecret(e.target.value)} className="h-10" />
              </Field>
              <DialogFooter>
                <Button variant="outline" onClick={close}>
                  Finish later
                </Button>
                <Button onClick={finish} disabled={pending || !providerSecret}>
                  Save and enable
                </Button>
              </DialogFooter>
            </>
          )}
          {step === "done" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="size-5 text-emerald-600" /> Webhook created
                </DialogTitle>
                <DialogDescription>Senders POST JSON to this URL. To act on deliveries, add a Webhook trigger to an automation.</DialogDescription>
              </DialogHeader>
              <UrlBox url={url} />
              {created?.secret && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Secret</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">{created.secret}</code>
                    <CopyButton value={created.secret} />
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="size-3.5" /> This secret is shown once. Store it in the sender now.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => (close(), router.push(`/f/${factory}/automations/new`))}>
                  Create automation
                </Button>
                <Button onClick={close}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UrlBox({ url }: { url: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Webhook URL</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">{url}</code>
        <CopyButton value={url} />
      </div>
      {url.includes("{token}") && <p className="text-xs text-muted-foreground">Replace {"{token}"} with the secret; the full URL is the credential.</p>}
    </div>
  );
}
