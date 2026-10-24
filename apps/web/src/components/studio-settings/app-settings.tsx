"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  StudioAgentPatch,
  StudioAppSettings,
  StudioDefinitionScope,
  StudioHarnessType,
  StudioSettingsPatch,
  StudioShipMode,
  StudioTeamRole,
} from "@kiln/sdk-ts";
import { SettingsRow, SettingsSection } from "@/components/kiln/settings-blocks";
import { SimpleSelect } from "@/components/kiln/simple-select";
import { TagListInput } from "@/components/kiln/tag-list-input";
import { useAction } from "@/components/kiln/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { timeAgo } from "@/lib/format";
import { restoreStudioDefinition, saveStudioSettings } from "./actions";

const HARNESSES: { value: StudioHarnessType; label: string }[] = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "OpenCode" },
  { value: "gemini", label: "Gemini" },
  { value: "pi", label: "Pi" },
];
const SHIP_MODES: { value: StudioShipMode; label: string }[] = [
  { value: "safe", label: "Safe" },
  { value: "review", label: "Review" },
  { value: "cowboy", label: "Cowboy" },
];
const ROLES: { value: StudioTeamRole; label: string }[] = [
  { value: "owner", label: "Owners" },
  { value: "admin", label: "Admins" },
  { value: "member", label: "Members" },
];
const LAYER_LABEL = { builtin: "Built-in", team: "Team", project: "Project", app: "App" } as const;
const INHERIT = "inherit";

/** Sections of the App settings page, in page order, for an anchor list. */
export const APP_SETTINGS_NAV = [
  { id: "general", label: "General" },
  { id: "agents", label: "Agents" },
  { id: "skills", label: "Skills" },
  { id: "policy", label: "Policy" },
  { id: "budget", label: "Budget" },
  { id: "versions", label: "Versions" },
];

/**
 * Settings of one Studio definition layer: an App's own (`{ app }`), a Kiln Project's defaults
 * (`{ project }`) or the team's (`"team"`). Values the layer doesn't set show what it inherits.
 * Policy changes need a team owner or admin; `canEditPolicy` disables them for everyone else.
 */
export function AppSettingsView({ scope, settings, canEditPolicy }: { scope: StudioDefinitionScope; settings: StudioAppSettings; canEditPolicy: boolean }) {
  const router = useRouter();
  const [pending, run] = useAction();
  const save = (patch: StudioSettingsPatch) => run(() => saveStudioSettings(scope, patch), { onSuccess: () => router.refresh() });
  const { resolved, own, layer } = settings;
  const ownLayer = layer.kind;
  // Forms seed their state once; a new resolved sha (after a save or refresh) seeds them again.
  const seed = settings.sha;

  return (
    <>
      <GeneralSection key={seed} resolved={resolved} own={own} pending={pending} save={save} />

      <SettingsSection id="agents" title="Agents">
        <div className="space-y-6">
          {resolved.agents.map((a) => (
            <AgentCard key={`${a.name}-${seed}`} agent={a} own={own.agents[a.name]} ownLayer={ownLayer} pending={pending} save={save} />
          ))}
          <AddByName label="Add agent" placeholder="reviewer" pending={pending} onAdd={(name) => save({ agents: { [name]: {} } })} />
        </div>
      </SettingsSection>

      <SettingsSection id="skills" title="Skills">
        <SkillsSection resolved={resolved} own={own} pending={pending} save={save} />
      </SettingsSection>

      <SettingsSection id="policy" title="Policy">
        <PolicySection resolved={resolved} own={own} pending={pending} disabled={!canEditPolicy} save={save} />
      </SettingsSection>

      <SettingsSection id="budget" title="Budget">
        <BudgetSection key={seed} resolved={resolved} own={own} pending={pending} save={save} />
      </SettingsSection>

      <SettingsSection id="versions" title="Versions">
        {layer.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet. Everything is inherited.</p>
        ) : (
          <ul className="divide-y text-sm">
            {[...layer.history].reverse().map((v, i) => (
              <li key={`${v.sha}-${v.at}`} className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <span className="font-mono text-xs">{v.sha.slice(0, 7)}</span>
                  <span className="ml-3 text-muted-foreground">
                    {v.message ?? "Settings changed"} · {v.by} · {timeAgo(v.at)}
                  </span>
                </div>
                {i === 0 ? (
                  <Badge variant="secondary">Current</Badge>
                ) : (
                  v.sha !== layer.sha && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => restoreStudioDefinition(scope, v.sha), { onSuccess: () => router.refresh() })}
                    >
                      Use
                    </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </>
  );
}

type SectionProps = { resolved: StudioAppSettings["resolved"]; own: StudioAppSettings["own"]; pending: boolean; save: (patch: StudioSettingsPatch) => unknown };

function GeneralSection({ resolved, own, pending, save }: SectionProps) {
  const [name, setName] = useState(own.name ?? "");
  const [description, setDescription] = useState(own.description ?? "");
  return (
    <SettingsSection id="general" title="General">
      <SettingsRow label="Name">
        <Input value={name} placeholder={resolved.name ?? ""} onChange={(e) => setName(e.target.value)} />
      </SettingsRow>
      <SettingsRow label="Description">
        <Input value={description} placeholder={resolved.description ?? ""} onChange={(e) => setDescription(e.target.value)} />
      </SettingsRow>
      <div className="mt-4 flex justify-end">
        <Button disabled={pending} onClick={() => save({ name: name.trim() || null, description: description.trim() || null })}>
          Save
        </Button>
      </div>
    </SettingsSection>
  );
}

function AgentCard({
  agent,
  own,
  ownLayer,
  pending,
  save,
}: {
  agent: StudioAppSettings["resolved"]["agents"][number];
  own: StudioAppSettings["own"]["agents"][string] | undefined;
  ownLayer: StudioAppSettings["layer"]["kind"];
  pending: boolean;
  save: (patch: StudioSettingsPatch) => unknown;
}) {
  const [harness, setHarness] = useState<string>(own?.harness ?? INHERIT);
  const [model, setModel] = useState(own?.model ?? "");
  const [description, setDescription] = useState(own?.description ?? "");
  const [mcpServers, setMcpServers] = useState<string[]>(own?.mcpServers ?? agent.mcpServers);
  const [spawnableBy, setSpawnableBy] = useState<string[]>(own?.spawnableBy ?? agent.spawnableBy);
  const [instructions, setInstructions] = useState(own?.instructions ?? "");
  const submit = () => {
    const patch: StudioAgentPatch = {
      description: description.trim() || null,
      harness: harness === INHERIT ? null : (harness as StudioHarnessType),
      model: model.trim() || null,
      instructions,
      mcpServers: sameList(mcpServers, agent.mcpServers) && !own?.mcpServers ? undefined : mcpServers,
      spawnableBy: sameList(spawnableBy, agent.spawnableBy) && !own?.spawnableBy ? undefined : spawnableBy,
    };
    save({ agents: { [agent.name]: patch } });
  };
  return (
    <div className="rounded-lg border bg-background p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{agent.name}</span>
          {agent.from !== ownLayer && <Badge variant="outline">{LAYER_LABEL[agent.from]}</Badge>}
        </div>
        {own && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => save({ agents: { [agent.name]: null } })}>
            {agent.name === "general" ? "Reset" : "Remove"}
          </Button>
        )}
      </div>
      <SettingsRow label="Description">
        <Input value={description} placeholder={agent.description ?? ""} onChange={(e) => setDescription(e.target.value)} />
      </SettingsRow>
      <SettingsRow label="Harness">
        <SimpleSelect
          value={harness}
          onChange={setHarness}
          options={[{ value: INHERIT, label: `Inherit (${label(HARNESSES, agent.harness)})` }, ...HARNESSES]}
          ariaLabel="Harness"
        />
      </SettingsRow>
      <SettingsRow label="Model">
        <Input value={model} placeholder={agent.model ?? "The harness default"} onChange={(e) => setModel(e.target.value)} />
      </SettingsRow>
      <SettingsRow label="MCP servers" hint="Names from MCPs and apps">
        <TagListInput value={mcpServers} onChange={setMcpServers} placeholder="figma" mono />
      </SettingsRow>
      <SettingsRow label="Spawnable by">
        <TagListInput value={spawnableBy} onChange={setSpawnableBy} placeholder="general" mono />
      </SettingsRow>
      <SettingsRow label="Instructions">
        <Textarea rows={5} value={instructions} placeholder={agent.instructions} onChange={(e) => setInstructions(e.target.value)} />
      </SettingsRow>
      <div className="mt-2 flex items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">Skills: {agent.skills.length ? agent.skills.join(", ") : "none"}</span>
        <Button size="sm" disabled={pending} onClick={submit}>
          Save
        </Button>
      </div>
    </div>
  );
}

function SkillsSection({ resolved, own, pending, save }: SectionProps) {
  const [editing, setEditing] = useState<{ name: string; description: string; body: string } | null>(null);
  const toggleMandatory = (name: string, on: boolean) =>
    save({ skills: { mandatory: on ? [...own.mandatory, name] : own.mandatory.filter((s) => s !== name) } });
  return (
    <div className="space-y-4">
      {resolved.skills.length === 0 && <p className="text-sm text-muted-foreground">No skills.</p>}
      {resolved.skills.map((s) => {
        const inheritedMandatory = s.mandatory && !own.mandatory.includes(s.name);
        return (
          <div key={s.name} className="flex items-start justify-between gap-4 border-b pb-3 last:border-b-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{s.name}</span>
                {!own.skills.includes(s.name) && <Badge variant="outline">{LAYER_LABEL[s.from]}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{s.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={s.mandatory} disabled={pending || inheritedMandatory} onCheckedChange={(on) => toggleMandatory(s.name, on)} />
                Mandatory
              </label>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing({ name: s.name, description: s.description, body: s.body })}>
                Edit
              </Button>
              {own.skills.includes(s.name) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => save({ skills: { remove: [s.name], mandatory: own.mandatory.filter((m) => m !== s.name) } })}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {editing ? (
        <div className="space-y-3 rounded-lg border bg-background p-4">
          <SettingsRow label="Name">
            <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </SettingsRow>
          <SettingsRow label="Description">
            <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </SettingsRow>
          <SettingsRow label="Instructions">
            <Textarea rows={8} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
          </SettingsRow>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending || !editing.name.trim() || !editing.description.trim()}
              onClick={() => {
                save({ skills: { upsert: [{ name: editing.name.trim(), description: editing.description.trim(), body: editing.body }] } });
                setEditing(null);
              }}
            >
              Save skill
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setEditing({ name: "", description: "", body: "" })}>
          Add skill
        </Button>
      )}
    </div>
  );
}

function PolicySection({ resolved, own, pending, disabled, save }: SectionProps & { disabled: boolean }) {
  const p = resolved.policy;
  const changed = (key: keyof typeof p.changedBy) => {
    const c = p.changedBy[key];
    return c ? `Changed by ${c.by} ${timeAgo(c.at)}` : undefined;
  };
  const modeOptions = (inherited: StudioShipMode) => [{ value: INHERIT, label: `Inherit (${label(SHIP_MODES, inherited)})` }, ...SHIP_MODES];
  return (
    <>
      {disabled && <p className="mb-4 text-sm text-muted-foreground">Team owners and admins change the policy.</p>}
      <SettingsRow label="Highest ship mode" hint={changed("maxShipMode")}>
        <SimpleSelect
          value={own.policy.maxShipMode ?? INHERIT}
          disabled={disabled || pending}
          onChange={(v) => save({ policy: { maxShipMode: v === INHERIT ? null : (v as StudioShipMode) } })}
          options={modeOptions(p.maxShipMode)}
          ariaLabel="Highest ship mode"
        />
      </SettingsRow>
      {ROLES.map((r) => (
        <SettingsRow key={r.value} label={r.label} hint={r.value === "owner" ? changed("roles") : undefined}>
          <SimpleSelect
            value={own.policy.roles[r.value] ?? INHERIT}
            disabled={disabled || pending}
            onChange={(v) => save({ policy: { roles: { [r.value]: v === INHERIT ? null : (v as StudioShipMode) } } })}
            options={modeOptions(p.roles[r.value] ?? p.maxShipMode)}
            ariaLabel={`Highest ship mode for ${r.label.toLowerCase()}`}
          />
        </SettingsRow>
      ))}
      <SettingsRow label="Push the default branch" hint={changed("pushDefaultBranch") ?? "Imported Apps in Cowboy mode"}>
        <Switch checked={p.pushDefaultBranch} disabled={disabled || pending} onCheckedChange={(on) => save({ policy: { pushDefaultBranch: on } })} />
      </SettingsRow>
      <SettingsRow label="Merge gate" hint={changed("mergeGate") ?? "Off: a person reviews every pull request"}>
        <Switch checked={p.mergeGate} disabled={disabled || pending} onCheckedChange={(on) => save({ policy: { mergeGate: on } })} />
      </SettingsRow>
    </>
  );
}

function BudgetSection({ resolved, own, pending, save }: SectionProps) {
  const [monthly, setMonthly] = useState(own.monthlyUsd?.toString() ?? "");
  const value = Number(monthly);
  const valid = monthly.trim() === "" || (Number.isFinite(value) && value > 0);
  return (
    <>
      <SettingsRow label="Monthly limit (USD)" hint={resolved.monthlyUsd !== undefined ? `In effect: $${resolved.monthlyUsd}` : "No limit"}>
        <Input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} aria-invalid={!valid} />
      </SettingsRow>
      <div className="mt-4 flex justify-end">
        <Button disabled={pending || !valid} onClick={() => save({ budgets: { monthlyUsd: monthly.trim() === "" ? null : value } })}>
          Save
        </Button>
      </div>
    </>
  );
}

function AddByName({ label: text, placeholder, pending, onAdd }: { label: string; placeholder: string; pending: boolean; onAdd: (name: string) => unknown }) {
  const [name, setName] = useState("");
  const valid = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(name.trim());
  return (
    <div className="flex gap-2">
      <Input value={name} placeholder={placeholder} onChange={(e) => setName(e.target.value)} className="max-w-60" aria-label="Agent name" />
      <Button
        variant="outline"
        disabled={pending || !valid}
        onClick={() => {
          onAdd(name.trim());
          setName("");
        }}
      >
        {text}
      </Button>
    </div>
  );
}

function label<T extends string>(options: { value: T; label: string }[], value: T): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
