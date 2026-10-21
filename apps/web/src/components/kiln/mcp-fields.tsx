"use client";

import { useState } from "react";
import { ExternalLink, Eye, EyeOff } from "lucide-react";
import { createTeamSecret } from "@/app/f/[factory]/settings/actions";
import { Input } from "@/components/ui/input";
import { fieldsError, withDefaults, type TemplateField } from "@/lib/mcp-config";

/** Values typed into an MCP server's fields; `saveSecrets` stores the secret ones as team secrets. */
export function useMcpFields(fields: TemplateField[], missing?: string[], source = "MCP") {
  const [values, setValues] = useState<Record<string, string>>({});
  const error = fields.length ? fieldsError(fields, values, missing) : undefined;
  const saveSecrets = async (): Promise<{ ok: boolean; error?: string }> => {
    const v = withDefaults(fields, values);
    for (const f of fields) {
      if (!f.secret || !v[f.key]) continue;
      const r = await createTeamSecret({ name: f.key, value: v[f.key]!, description: `${source}: ${f.label.toLowerCase()}` });
      if (!r.ok) return r;
    }
    return { ok: true };
  };
  return { values, setValues, ready: !error, error, saveSecrets, reset: () => setValues({}) };
}

/** One labeled field per value a server needs, each with where to find it. */
export function McpFields({
  fields,
  values,
  onChange,
  missing,
  docs,
}: {
  fields: TemplateField[];
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  missing?: string[];
  docs?: string;
}) {
  const [shown, setShown] = useState<string[]>([]);
  return (
    <div className="grid gap-4">
      {fields.map((f) => {
        const kept = f.secret && missing !== undefined && !missing.includes(f.key);
        const hidden = f.kind === "password" && !shown.includes(f.key);
        return (
          <label key={f.key} className="grid gap-1.5">
            <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
              {f.label}
              {f.secret && <code className="font-mono text-xs font-normal text-muted-foreground">{f.key}</code>}
            </span>
            <div className="relative">
              <Input
                type={hidden ? "password" : f.kind === "url" ? "url" : "text"}
                value={values[f.key] ?? f.value ?? ""}
                onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
                placeholder={kept ? "Already set. Leave empty to keep it." : f.placeholder}
                autoComplete="off"
                className="h-10 pr-9"
              />
              {f.kind === "password" && (
                <button
                  type="button"
                  aria-label={hidden ? `Show ${f.label}` : `Hide ${f.label}`}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShown((s) => (s.includes(f.key) ? s.filter((x) => x !== f.key) : [...s, f.key]))}
                >
                  {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                </button>
              )}
            </div>
            <span className="text-xs text-muted-foreground">{f.hint}</span>
          </label>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Keys are saved as team secrets, encrypted and never shown again. Runs may reach the hosts above.
        {docs && (
          <>
            {" "}
            <a
              href={docs}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-4 hover:underline"
            >
              Setup guide <ExternalLink className="size-3" />
            </a>
          </>
        )}
      </p>
    </div>
  );
}
