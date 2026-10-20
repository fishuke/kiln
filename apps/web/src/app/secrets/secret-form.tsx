"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Trash2 } from "lucide-react";
import type { SecretType } from "@kiln/sdk-ts";
import { ConfirmAction } from "@/components/kiln/confirm-action";
import { PageHeader } from "@/components/kiln/ui";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SECRET_TYPES, secretType, toSecretName, validSecretName, type SecretTypeId } from "@/lib/secret-types";
import { cn } from "@/lib/utils";
import { createSecret, deleteSecret, updateSecret } from "./actions";

type Existing = { scope: "team" | "personal"; name: string; type: SecretTypeId; description?: string; updatedAt: string; updatedBy: string };

const GROUPS = ["General", "Image credentials", "Harness credentials"] as const;

export function SecretForm({ existing, canTeam, initialScope, initialType }: { existing?: Existing; canTeam: boolean; initialScope?: "team" | "personal"; initialType?: SecretTypeId }) {
  const router = useRouter();
  const [pending, run] = useAction();
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<SecretTypeId>(existing?.type ?? initialType ?? "raw");
  const [scope, setScope] = useState<"team" | "personal">(existing?.scope ?? initialScope ?? (canTeam ? "team" : "personal"));
  const [value, setValue] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [description, setDescription] = useState(existing?.description ?? "");
  const meta = secretType(type);
  const editing = Boolean(existing);

  const hasValue = meta.fields ? meta.fields.every((f) => f.optional || fields[f.key]?.trim()) : value.length > 0;
  const nameOk = validSecretName(name);
  const valid = editing ? hasValue || description !== (existing!.description ?? "") : nameOk && hasValue && !(meta.teamOnly && scope !== "team");
  const valuePayload = () => (meta.fields ? Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])) : value);

  const save = () => {
    if (editing) {
      const patch: { value?: unknown; description?: string } = {};
      if (hasValue) patch.value = valuePayload();
      if (description !== (existing!.description ?? "")) patch.description = description;
      return run(() => updateSecret(existing!.scope, existing!.name, patch), { onSuccess: () => router.push("/secrets") });
    }
    return run(() => createSecret({ scope, name, type: type as SecretType, value: valuePayload(), description }), { onSuccess: () => router.push("/secrets") });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
    >
      <PageHeader
        crumbs={[{ label: "Secrets", href: "/secrets" }, { label: name || "Untitled" }]}
        actions={
          <>
            {editing && (
              <ConfirmAction
                title={`Delete ${existing!.name}?`}
                description="Runs that list this secret will no longer get it. This cannot be undone."
                action={() => deleteSecret(existing!.scope, existing!.name)}
                onDone={() => router.push("/secrets")}
                trigger={(open) => (
                  <Button type="button" variant="ghost" size="icon" aria-label="Delete secret" onClick={open} className="text-muted-foreground hover:text-destructive">
                    <Trash2 />
                  </Button>
                )}
              />
            )}
            <Button type="submit" variant={valid ? "default" : "secondary"} disabled={!valid || pending} className="h-8 px-3">
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      <div className="mx-auto w-full max-w-[672px] px-6 pt-6 pb-20">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <KeyRound className="size-5" />
          </span>
          <input
            aria-label="Secret name"
            autoFocus={!editing}
            readOnly={editing}
            value={name}
            onChange={(e) => setName(toSecretName(e.target.value))}
            placeholder="Untitled"
            className="h-12 min-w-0 flex-1 rounded-lg border-2 border-transparent bg-transparent px-1 font-mono text-2xl font-semibold outline-none placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-foreground read-only:focus:border-transparent"
          />
        </div>
        {!editing && name && !nameOk && <p className="mt-1 ml-14 text-xs text-destructive">Use letters, digits and underscores, starting with a letter or underscore.</p>}

        <div className="mt-6 space-y-2">
          <label className="text-sm font-medium">Type</label>
          {editing ? (
            <div className="flex h-10 items-center rounded-lg border bg-muted/50 px-3 text-sm">{meta.label}</div>
          ) : (
            <Select
              items={SECRET_TYPES.map((t) => ({ value: t.id, label: t.label }))}
              value={type}
              onValueChange={(v) => {
                if (!v) return;
                setType(v as SecretTypeId);
                setFields({});
                setValue("");
                if (secretType(v as string).teamOnly) setScope("team");
              }}
            >
              <SelectTrigger className="w-full data-[size=default]:h-10" aria-label="Secret type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map((g) => (
                  <SelectGroup key={g}>
                    <SelectLabel>{g}</SelectLabel>
                    {SECRET_TYPES.filter((t) => t.group === g).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="mt-6 space-y-2">
          <span className="text-sm font-medium">Scope</span>
          <div role="radiogroup" aria-label="Scope" className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["team", "Team", "Runs of the team's factories get it when an agent lists it.", !canTeam],
                ["personal", "Personal", "Only runs you start get it. Overrides a team secret of the same name.", meta.teamOnly],
              ] as const
            ).map(([v, label, hint, disabled]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={scope === v}
                disabled={editing || Boolean(disabled)}
                onClick={() => setScope(v)}
                className={cn("flex flex-col justify-start rounded-lg border p-3 text-left transition-colors enabled:hover:bg-muted disabled:cursor-not-allowed", scope === v ? "border-foreground ring-1 ring-foreground" : "disabled:opacity-50")}
              >
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{hint}</div>
              </button>
            ))}
          </div>
          {!canTeam && !editing && <p className="text-xs text-muted-foreground">Team secrets are managed by team owners and admins.</p>}
        </div>

        <div className="mt-6 space-y-2">
          {meta.fields ? (
            <div className="grid gap-3">
              {meta.fields.map((f) => (
                <label key={f.key} className="grid gap-1.5">
                  <span className="text-sm font-medium">
                    {f.label}
                    {f.optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
                  </span>
                  <Input
                    type={f.secret ? "password" : "text"}
                    autoComplete="off"
                    placeholder={editing ? "Leave empty to keep the current value" : f.placeholder}
                    value={fields[f.key] ?? ""}
                    onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                    className="h-10 font-mono"
                  />
                </label>
              ))}
            </div>
          ) : (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">Value</span>
              <Input type="password" autoComplete="off" placeholder={editing ? "Enter a new value to replace the current one" : (meta.placeholder ?? "Enter secret value")} value={value} onChange={(e) => setValue(e.target.value)} className="h-10 font-mono" />
            </label>
          )}
          <p className="text-sm text-muted-foreground">
            The value is write-only: Kiln stores it encrypted on your server (with <code className="font-mono text-xs">KILN_SECRET_KEY</code> set), never shows it again, and redacts it from run output.
          </p>
        </div>

        <label className="mt-6 grid gap-1.5">
          <span className="text-xs font-medium">Description (optional)</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this secret used for?" className="min-h-48 resize-y" maxLength={500} />
        </label>

        <div className="mt-6 border-t pt-5 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">Gives runs:</span>
            <span className="font-mono text-xs text-muted-foreground">{meta.gives(name)}</span>
          </div>
          <p className="mt-2 text-muted-foreground">
            Agents get this secret when their definition lists it, for example <code className="rounded bg-muted px-1 font-mono text-xs">secrets: [{name || "NAME"}]</code> in the agent file, or by name in an MCP server header as <code className="rounded bg-muted px-1 font-mono text-xs">{`{{${name || "NAME"}}}`}</code>.
          </p>
          {existing && (
            <p className="mt-2 text-xs text-muted-foreground">
              Last changed by {existing.updatedBy} on {new Date(existing.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
