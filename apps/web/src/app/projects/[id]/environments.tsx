"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { VariableLayerView } from "@kiln/sdk-ts";
import { ConfirmAction } from "@/components/kiln/confirm-action";
import { useAction } from "@/components/kiln/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { rowProblem, toVariableInputs, type VariableRow } from "@/lib/variables";
import { deleteProjectEnvironment, saveProjectVariables } from "./environment-actions";

const ENV_NAME = /^[a-z][a-z0-9-]{0,31}$/;
type Row = VariableRow & { id: number };

let nextId = 0;
const rowsOf = (layer?: VariableLayerView): Row[] =>
  (layer?.variables ?? []).map((v) => ({ id: nextId++, key: v.key, value: v.secret ? "" : v.value, secret: v.secret, stored: v.secret }));

/** Project → Environments: one card per environment, with the team's variables it inherits. */
export function ProjectEnvironments({
  projectId,
  layers,
  team,
  canEdit,
}: {
  projectId: string;
  layers: VariableLayerView[];
  team: VariableLayerView[];
  canEdit: boolean;
}) {
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const names = [...new Set(["preview", ...layers.map((l) => l.environment), ...team.map((l) => l.environment), ...added])].sort((a, b) =>
    a === "preview" ? -1 : b === "preview" ? 1 : a.localeCompare(b),
  );
  const draftOk = ENV_NAME.test(draft) && !names.includes(draft);

  return (
    <div className="space-y-4">
      {names.map((name) => (
        <EnvironmentCard
          key={`${name}:${layers.find((l) => l.environment === name)?.updatedAt ?? ""}`}
          projectId={projectId}
          name={name}
          layer={layers.find((l) => l.environment === name)}
          inherited={team.find((l) => l.environment === name)}
          canEdit={canEdit}
          onRemoved={() => setAdded(added.filter((a) => a !== name))}
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
  projectId,
  name,
  layer,
  inherited,
  canEdit,
  onRemoved,
}: {
  projectId: string;
  name: string;
  layer?: VariableLayerView;
  inherited?: VariableLayerView;
  canEdit: boolean;
  onRemoved: () => void;
}) {
  const [pending, run] = useAction();
  const [rows, setRows] = useState<Row[]>(() => rowsOf(layer));
  const set = (id: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const problem = rowProblem(rows);
  const overridden = new Set(rows.map((r) => r.key.trim()));
  const save = () => run(() => saveProjectVariables(projectId, name, toVariableInputs(rows)));

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
                description="The project's variables for this environment are removed. Team variables still apply."
                action={() => deleteProjectEnvironment(projectId, name)}
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
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No project variables.</p>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <Input
              value={r.key}
              onChange={(e) => set(r.id, { key: e.target.value })}
              placeholder="API_URL"
              aria-label="Key"
              className="h-8 w-56 shrink-0 font-mono"
            />
            <Input
              value={r.value}
              onChange={(e) => set(r.id, { value: e.target.value })}
              type={r.secret ? "password" : "text"}
              placeholder={r.secret && r.stored ? "Saved. Enter a new value to replace it" : "Value"}
              aria-label={`Value of ${r.key || "variable"}`}
              autoComplete="off"
              className="h-8 min-w-0 flex-1 font-mono"
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Switch
                size="sm"
                checked={r.secret}
                onCheckedChange={(c) => set(r.id, { secret: c })}
                aria-label={`${r.key || "Variable"} is a secret`}
              />
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
            onClick={() => setRows([...rows, { id: nextId++, key: "", value: "", secret: false, stored: false }])}
          >
            <Plus /> Add variable
          </Button>
        )}
      </fieldset>
      {inherited && inherited.variables.length > 0 && (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">From the team</p>
          <ul className="space-y-1 text-sm">
            {inherited.variables.map((v) => (
              <li key={v.key} className="flex items-center gap-2">
                <span className={overridden.has(v.key) ? "font-mono text-muted-foreground line-through" : "font-mono"}>{v.key}</span>
                <span className="truncate font-mono text-muted-foreground">{v.secret ? "Secret" : v.value}</span>
                {overridden.has(v.key) && <span className="text-xs text-muted-foreground">Overridden</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
