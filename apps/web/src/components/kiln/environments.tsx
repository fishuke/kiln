"use client";

import { useState, type ClipboardEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { VariableLayerView } from "@kiln/sdk-ts";
import { ConfirmAction } from "@/components/kiln/confirm-action";
import { useAction } from "@/components/kiln/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { parseDotenv } from "@/lib/secret-types";
import { mergePasted, rowProblem, toVariableInputs, type VariableRow } from "@/lib/variables";
import { deleteEnvironment, saveVariables, type EnvironmentScope } from "./environment-actions";

const ENV_NAME = /^[a-z][a-z0-9-]{0,31}$/;
type Row = VariableRow & { id: number };
/** Variables from a parent layer (the team, the App's project), shown read-only on each card. */
export type InheritedLayers = { from: string; layers: VariableLayerView[] };
const NOUN: Record<EnvironmentScope, string> = { project: "project", app: "App" };

let nextId = 0;
const blankRow = (key = "", value = ""): Row => ({ id: nextId++, key, value, secret: false, stored: false });
const rowsOf = (layer?: VariableLayerView): Row[] =>
  (layer?.variables ?? []).map((v) => ({ id: nextId++, key: v.key, value: v.secret ? "" : v.value, secret: v.secret, stored: v.secret }));

/** Environments of a project or a Studio App: one card per environment, with the variables it inherits. */
export function Environments({
  scope,
  owner,
  layers,
  inherited,
  canEdit,
  onSaved,
}: {
  scope: EnvironmentScope;
  owner: string;
  layers: VariableLayerView[];
  inherited: InheritedLayers[];
  canEdit: boolean;
  onSaved?: () => void;
}) {
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const names = [...new Set(["preview", ...layers.map((l) => l.environment), ...inherited.flatMap((i) => i.layers.map((l) => l.environment)), ...added])].sort(
    (a, b) => (a === "preview" ? -1 : b === "preview" ? 1 : a.localeCompare(b)),
  );
  const draftOk = ENV_NAME.test(draft) && !names.includes(draft);

  return (
    <div className="space-y-4">
      {names.map((name) => (
        <EnvironmentCard
          key={`${name}:${layers.find((l) => l.environment === name)?.updatedAt ?? ""}`}
          scope={scope}
          owner={owner}
          name={name}
          layer={layers.find((l) => l.environment === name)}
          inherited={inherited.flatMap((i) => {
            const l = i.layers.find((x) => x.environment === name);
            return l?.variables.length ? [{ from: i.from, variables: l.variables }] : [];
          })}
          canEdit={canEdit}
          onSaved={onSaved}
          onRemoved={() => {
            setAdded(added.filter((a) => a !== name));
            onSaved?.();
          }}
        />
      ))}
      {canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftOk) return;
            setAdded([...added, draft]);
            setDraft("");
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toLowerCase())}
            placeholder="production"
            aria-label="Environment name"
            className="h-8 max-w-56 font-mono"
          />
          <Button type="submit" variant="outline" disabled={!draftOk}>
            <Plus /> Add environment
          </Button>
        </form>
      )}
    </div>
  );
}

function EnvironmentCard({
  scope,
  owner,
  name,
  layer,
  inherited,
  canEdit,
  onSaved,
  onRemoved,
}: {
  scope: EnvironmentScope;
  owner: string;
  name: string;
  layer?: VariableLayerView;
  inherited: { from: string; variables: VariableLayerView["variables"] }[];
  canEdit: boolean;
  onSaved?: () => void;
  onRemoved: () => void;
}) {
  const [pending, run] = useAction();
  const [rows, setRows] = useState<Row[]>(() => rowsOf(layer));
  const set = (id: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const problem = rowProblem(rows);
  // Pasting a .env (KEY=value lines) into a field fills one row per variable.
  const paste = (r: Row, text: string, e: ClipboardEvent) => {
    const pairs = text.includes("\n") || text.includes("=") ? parseDotenv(text) : [];
    if (pairs.length === 0) return;
    e.preventDefault();
    setRows(mergePasted(rows, r, pairs, blankRow));
  };
  const save = () => run(() => saveVariables(scope, owner, name, toVariableInputs(rows)), { onSuccess: onSaved });

  return (
    <div className="rounded-xl border">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="font-mono text-sm font-medium">{name}</span>
        {name === "preview" && <Badge variant="secondary">Used by runs and previews</Badge>}
        {canEdit && (
          <div className="ml-auto flex items-center gap-2">
            {problem && rows.some((r) => r.key) && <span className="text-xs text-destructive">{problem}</span>}
            {layer && (
              <ConfirmAction
                title={`Delete the ${name} variables?`}
                description={`The ${NOUN[scope]}'s variables for this environment are removed. Inherited variables still apply.`}
                action={() => deleteEnvironment(scope, owner, name)}
                onDone={onRemoved}
                trigger={(open) => (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${name}`}
                    onClick={open}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                )}
              />
            )}
            <Button type="button" size="sm" disabled={Boolean(problem) || pending} onClick={() => void save()}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>
      <fieldset disabled={!canEdit} className="space-y-2 p-4">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No {NOUN[scope]} variables.</p>}
        {canEdit && <p className="text-xs text-muted-foreground">Tip: paste a .env into a key field to add many variables at once.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <Input
              value={r.key}
              onChange={(e) => set(r.id, { key: e.target.value })}
              onPaste={(e) => paste(r, e.clipboardData.getData("text"), e)}
              placeholder="API_URL"
              aria-label="Key"
              className="h-8 w-56 shrink-0 font-mono"
            />
            <Input
              value={r.value}
              onChange={(e) => set(r.id, { value: e.target.value })}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (text.trim().includes("\n")) paste(r, text, e);
              }}
              type={r.secret ? "password" : "text"}
              placeholder={r.secret && r.stored ? "Saved. Enter a new value to replace it" : "Value"}
              aria-label={`Value of ${r.key || "variable"}`}
              autoComplete="off"
              className="h-8 min-w-0 flex-1 font-mono"
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Switch size="sm" checked={r.secret} onCheckedChange={(c) => set(r.id, { secret: c })} aria-label={`${r.key || "Variable"} is a secret`} />
              Secret
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${r.key || "variable"}`}
              onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
            >
              <X />
            </Button>
          </div>
        ))}
        {canEdit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRows([...rows, blankRow()])}
          >
            <Plus /> Add variable
          </Button>
        )}
      </fieldset>
      {inherited.map((src, i) => {
        // A key set here, or by a later (closer) parent, replaces this one.
        const closer = new Set([...rows.map((r) => r.key.trim()), ...inherited.slice(i + 1).flatMap((x) => x.variables.map((v) => v.key))]);
        return (
          <div key={src.from} className="border-t px-4 py-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">From the {src.from}</p>
            <ul className="space-y-1 text-sm">
              {src.variables.map((v) => (
                <li key={v.key} className="flex items-center gap-2">
                  <span className={closer.has(v.key) ? "font-mono text-muted-foreground line-through" : "font-mono"}>{v.key}</span>
                  <span className="truncate font-mono text-muted-foreground">{v.secret ? "Secret" : v.value}</span>
                  {closer.has(v.key) && <span className="text-xs text-muted-foreground">Overridden</span>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
