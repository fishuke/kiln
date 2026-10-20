"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FlaskConical, Plus, Trash2 } from "lucide-react";
import { ChipSelect, TokenPicker } from "@/components/kiln/form-controls";
import { ProviderIcon } from "@/components/kiln/provider-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { eventDef, groupedEvents, inlineFilterKeys, providerDef, PROVIDERS, WORK_ITEM_STAGES, type FilterField } from "@/lib/automations/catalog";
import { cronFromSchedule, cronProblem, DAYS, describeCron, gmtLabel, localOffset, nextRun, scheduleFromCron, type Frequency, type ScheduleForm } from "@/lib/automations/cron";
import { matcherIsEmpty, newTrigger, type BotPolicy, type Matcher, type TriggerModel } from "@/lib/automations/model";
import { cn } from "@/lib/utils";

export type TriggerContext = {
  factory: string;
  repositories: string[];
  webhooks: { uid: string; name: string }[];
  connected: string[];
  alias: string;
  /** Saved automation name, needed for Test filter. */
  savedName?: string;
  onTestFilter?: (index: number) => void;
};

const BRANCHES = ["main", "master", "develop", "release"];

function suggestionsFor(field: FilterField, ctx: TriggerContext): string[] {
  switch (field.picker) {
    case "repos":
      return ctx.repositories;
    case "branches":
      return BRANCHES;
    case "labels":
      return [`factory:${ctx.alias}`, "kiln-ready", "bug", "needs-repro", "needs-ui-check", "wip"];
    case "stages":
      return WORK_ITEM_STAGES;
    case "users":
      return field.key === "mentioned" ? [`kiln-factory`] : [];
    default:
      return [];
  }
}

const supportsExclude = (f: FilterField) => f.kind === "string" || f.kind === "int";

/** Values and operator of a matcher as the editor shows them. */
function view(m: Matcher | undefined): { op: "in" | "not_in"; values: string[] } {
  if (!m) return { op: "in", values: [] };
  if (!m.in?.length && m.not_in?.length) return { op: "not_in", values: m.not_in.map(String) };
  return { op: "in", values: (m.in ?? []).map(String) };
}

function setValues(field: FilterField, m: Matcher | undefined, op: "in" | "not_in", values: string[]): Matcher {
  const typed = field.kind === "int" || field.kind === "int_alias" ? values.map(Number) : values;
  const key = m?.key ?? field.alias ?? field.key;
  if (op === "not_in") return { key: field.alias && key === field.alias ? field.key : key, ...(m?.in?.length && m.not_in?.length ? { in: m.in } : {}), not_in: typed };
  return { key, in: typed, ...(m?.not_in?.length && m.in?.length ? { not_in: m.not_in } : {}) };
}

function FilterValues({ field, matcher, onChange, ctx, inline }: { field: FilterField; matcher?: Matcher; onChange: (m: Matcher) => void; ctx: TriggerContext; inline?: boolean }) {
  const v = view(matcher);
  const set = (values: string[], op = v.op) => onChange(setValues(field, matcher, op, values));
  const width = inline ? "w-auto min-w-44" : "w-full";
  if (field.picker === "options" && field.options) {
    return <TokenPicker label={field.label} values={v.values} onChange={set} suggestions={field.options} placeholder={field.placeholder} className={width} />;
  }
  const free = ["globs", "keywords", "free", "numbers"].includes(field.picker);
  return (
    <TokenPicker
      label={field.label}
      values={v.values}
      onChange={set}
      suggestions={suggestionsFor(field, ctx)}
      placeholder={field.placeholder}
      free={free}
      numeric={field.kind === "int" || field.kind === "int_alias"}
      className={width}
      emptyHint={field.picker === "repos" ? "No repositories on this factory yet. Type owner/name and press Enter." : undefined}
      validate={field.picker === "repos" ? (x) => (/^[^/\s]+\/[^/\s]+$/.test(x) ? null : "Use owner/name") : undefined}
    />
  );
}

function OperatorChip({ field, matcher, onChange, words }: { field: FilterField; matcher?: Matcher; onChange: (m: Matcher) => void; words: [string, string] }) {
  const v = view(matcher);
  return (
    <ChipSelect
      label={`${field.label} operator`}
      value={v.op}
      options={[
        { value: "in", label: words[0] },
        { value: "not_in", label: words[1] },
      ]}
      onChange={(op) => onChange(setValues(field, matcher, op, v.values))}
    />
  );
}

/** One "More filters" row: label column, optional operator, value picker. */
function FilterRow({ field, t, update, ctx }: { field: FilterField; t: TriggerModel; update: (t: TriggerModel) => void; ctx: TriggerContext }) {
  const setMatcher = (m: Matcher) => update({ ...t, filters: { ...t.filters, [field.key]: m } });
  if (field.kind === "bots") {
    return (
      <div className="grid grid-cols-[160px_1fr] items-center gap-3">
        <span className="text-sm">{field.label}</span>
        <ChipSelect<BotPolicy> label={field.label} value={t.skipBots ?? "all"} options={field.options!.map((o) => ({ value: o.value as BotPolicy, label: o.label }))} onChange={(skipBots) => update({ ...t, skipBots })} className="w-full justify-between" />
      </div>
    );
  }
  if (field.kind === "payload") return <PayloadRow t={t} update={update} />;
  if (field.kind === "webhook_ids") return null;
  const exclude = supportsExclude(field);
  return (
    <div className="grid grid-cols-[160px_1fr] items-center gap-3">
      <span className="text-sm">{field.label}</span>
      <div className="flex min-w-0 items-center gap-2">
        {exclude && field.picker !== "globs" && <OperatorChip field={field} matcher={t.filters[field.key]} onChange={setMatcher} words={["is any of", "is none of"]} />}
        <div className="min-w-0 flex-1">
          <FilterValues field={field} matcher={t.filters[field.key]} onChange={setMatcher} ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

function PayloadRow({ t, update }: { t: TriggerModel; update: (t: TriggerModel) => void }) {
  const [text, setText] = useState(() => (t.payload === undefined ? "" : JSON.stringify(t.payload, null, 2)));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3">
      <div>
        <span className="text-sm">Payload</span>
        <p className="mt-1 text-xs text-muted-foreground">Keys mirror the JSON body. A list means any of; use {"{ in, not_in, exists }"} for more.</p>
      </div>
      <div>
        <textarea
          aria-label="Payload filter"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value.trim()) {
              setError(null);
              return update({ ...t, payload: undefined });
            }
            try {
              const v = JSON.parse(e.target.value);
              if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("Use a JSON object of fields");
              setError(null);
              update({ ...t, payload: v });
            } catch (err) {
              setError((err as Error).message);
            }
          }}
          placeholder={'{\n  "data": { "issue": { "level": ["fatal"] } }\n}'}
          className="min-h-28 w-full rounded-md bg-muted px-3 py-2 font-mono text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function summaryLines(t: TriggerModel, fields: FilterField[]) {
  return fields
    .filter((f) => !matcherIsEmpty(t.filters[f.key]))
    .map((f) => {
      const v = view(t.filters[f.key]);
      return { label: f.label, text: `${v.op === "not_in" ? "not " : ""}${v.values.join(", ")}` };
    });
}

/** A provider event trigger rendered as a sentence of inline controls, with More filters below. */
export function EventTriggerRow({ t, update, remove, ctx, index }: { t: TriggerModel; update: (t: TriggerModel) => void; remove: () => void; ctx: TriggerContext; index: number }) {
  const p = providerDef(t.provider);
  const e = eventDef(t.provider, t.event);
  const fields = e?.filters ?? [];
  const inlineKeys = inlineFilterKeys(t.provider);
  const inline = fields.filter((f) => inlineKeys.includes(f.key));
  const more = fields.filter((f) => !inlineKeys.includes(f.key));
  const moreSet = more.some((f) => !matcherIsEmpty(t.filters[f.key]) || (f.kind === "bots" && t.skipBots && t.skipBots !== "all") || (f.kind === "payload" && t.payload !== undefined));
  const [open, setOpen] = useState(moreSet);
  const events = (p?.events ?? []).filter((x) => x.menu !== false || x.id === t.event);
  const setMatcher = (key: string) => (m: Matcher) => update({ ...t, filters: { ...t.filters, [key]: m } });
  const summary = summaryLines(t, inline.filter((f) => f.picker !== "repos"));
  const unknownKeys = Object.keys(t.unknown);

  return (
    <div className="group/trigger px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <ProviderIcon provider={t.provider} />
        {e ? (
          <ChipSelect label={`${p?.label ?? t.provider} event`} value={t.event} options={events.map((x) => ({ value: x.id, label: x.label }))} onChange={(event) => update({ ...newTrigger(t.provider, event), skipBots: t.skipBots })} />
        ) : (
          <span className="text-sm text-muted-foreground">
            {t.provider} / {t.event}
          </span>
        )}
        {t.provider === "webhook" && (
          <ChipSelect
            label="Webhook"
            value={t.webhook ?? ""}
            options={[...(t.webhook && !ctx.webhooks.some((w) => w.uid === t.webhook || w.name === t.webhook) ? [{ value: t.webhook, label: t.webhook }] : []), ...ctx.webhooks.map((w) => ({ value: w.uid, label: w.name })), ...(ctx.webhooks.length ? [] : [{ value: "", label: "No webhooks yet" }])]}
            onChange={(webhook) => update({ ...t, webhook: webhook || undefined })}
          />
        )}
        {inline.map((f) => {
          if (f.kind === "webhook_ids") return null;
          const m = t.filters[f.key];
          const isRepo = f.picker === "repos";
          return (
            <span key={f.key} className="flex items-center gap-2">
              {isRepo || !supportsExclude(f) ? (
                <span className="text-sm text-muted-foreground">in</span>
              ) : (
                <OperatorChip field={f} matcher={m} onChange={setMatcher(f.key)} words={f.key === "labels" ? ["with", "without"] : ["in", "not in"]} />
              )}
              <FilterValues field={f} matcher={m} onChange={setMatcher(f.key)} ctx={ctx} inline />
            </span>
          );
        })}
        <div className="ml-auto flex items-center gap-1">
          {t.provider === "webhook" && (
            <Tooltip>
              <TooltipTrigger render={<span />}>
                <Button type="button" variant="outline" size="sm" disabled={!ctx.savedName || !t.webhook} onClick={() => ctx.onTestFilter?.(index)}>
                  <FlaskConical /> Test filter
                </Button>
              </TooltipTrigger>
              {(!ctx.savedName || !t.webhook) && <TooltipContent>{!ctx.savedName ? "Save this automation first" : "Choose a webhook first"}</TooltipContent>}
            </Tooltip>
          )}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove trigger" onClick={remove} className="text-muted-foreground opacity-0 group-hover/trigger:opacity-100 focus-visible:opacity-100">
            <Trash2 />
          </Button>
        </div>
      </div>
      {(summary.length > 0 || unknownKeys.length > 0) && (
        <div className="mt-2 space-y-0.5 pl-6 text-xs text-muted-foreground">
          {summary.map((s) => (
            <div key={s.label}>
              <span className="font-semibold text-foreground/80">{s.label}:</span> {s.text}
            </div>
          ))}
          {unknownKeys.length > 0 && <div>Also keeps filters this editor does not show: {unknownKeys.join(", ")}</div>}
        </div>
      )}
      {more.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 ml-6 inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400">
            More filters {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {open && (
            <div className="mt-2 space-y-2 border-t pt-3 pl-6">
              {more.map((f) => (
                <FilterRow key={f.key} field={f} t={t} update={update} ctx={ctx} />
              ))}
              <p className="pt-1 text-xs text-muted-foreground">All filters in this trigger must match. Add another trigger to match an alternative set of conditions.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Schedule trigger: frequency, day, time in local time; stored as a UTC cron. */
export function ScheduleTriggerRow({ t, update, remove }: { t: TriggerModel; update: (t: TriggerModel) => void; remove: () => void }) {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(localOffset()), []);
  const cron = t.schedule?.cron ?? "0 9 * * 1";
  const form = useMemo(() => scheduleFromCron(cron, offset), [cron, offset]);
  const [custom, setCustom] = useState(form.frequency === "custom" ? cron : "");
  const set = (patch: Partial<ScheduleForm>) => {
    const next = { ...form, ...patch };
    const c = next.frequency === "custom" ? next.cron : cronFromSchedule(next, offset);
    update({ ...t, schedule: { ...t.schedule, cron: c } });
  };
  const h12 = form.hour % 12 === 0 ? 12 : form.hour % 12;
  const pm = form.hour >= 12;
  const problem = cronProblem(cron);
  const next = problem ? null : nextRun(cron);
  const nextLabel = next
    ? `${next.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" })} at ${next.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} ${gmtLabel(-next.getTimezoneOffset())}`
    : null;
  return (
    <div className="group/trigger px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ProviderIcon provider="schedule" />
        <ChipSelect<Frequency>
          label="Frequency"
          value={form.frequency}
          options={[
            { value: "hourly", label: "Hourly" },
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "custom", label: "Custom (cron)" },
          ]}
          onChange={(frequency) => {
            if (frequency === "custom") {
              setCustom(cron);
              set({ frequency, cron });
            } else set({ frequency, hour: form.frequency === "hourly" || form.frequency === "custom" ? 9 : form.hour, minute: form.frequency === "custom" ? 0 : form.minute, day: form.frequency === "weekly" ? form.day : 1 });
          }}
        />
        {form.frequency === "weekly" && (
          <>
            <span className="text-muted-foreground">on</span>
            <ChipSelect label="Day" value={String(form.day)} options={DAYS.map((d, i) => ({ value: String(i), label: d }))} onChange={(d) => set({ day: Number(d) })} />
          </>
        )}
        {form.frequency === "hourly" && (
          <>
            <span className="text-muted-foreground">at minute</span>
            <ChipSelect label="Minute" value={pad(form.minute)} options={Array.from({ length: 60 }, (_, i) => ({ value: pad(i), label: pad(i) }))} onChange={(m) => set({ minute: Number(m) })} />
          </>
        )}
        {(form.frequency === "daily" || form.frequency === "weekly") && (
          <>
            <span className="text-muted-foreground">at</span>
            <ChipSelect label="Hour" value={String(h12)} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} onChange={(h) => set({ hour: (Number(h) % 12) + (pm ? 12 : 0) })} />
            <span className="text-muted-foreground">:</span>
            <ChipSelect label="Minute" value={pad(form.minute)} options={Array.from({ length: 60 }, (_, i) => ({ value: pad(i), label: pad(i) }))} onChange={(m) => set({ minute: Number(m) })} />
            <ChipSelect label="AM or PM" value={pm ? "PM" : "AM"} options={[{ value: "AM", label: "AM" }, { value: "PM", label: "PM" }]} onChange={(x) => set({ hour: (form.hour % 12) + (x === "PM" ? 12 : 0) })} />
            <span className="font-medium">{gmtLabel(offset)}</span>
          </>
        )}
        {form.frequency === "custom" && (
          <input
            aria-label="Cron expression"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              update({ ...t, schedule: { ...t.schedule, cron: e.target.value } });
            }}
            placeholder="0 9 * * 1  or  @every 30m"
            className="h-9 w-56 rounded-md bg-muted px-2.5 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        )}
        {nextLabel && (
          <span className="text-muted-foreground">
            Next run <span className="text-foreground/80">{nextLabel}</span>
          </span>
        )}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove trigger" onClick={remove} className="ml-auto text-muted-foreground opacity-0 group-hover/trigger:opacity-100 focus-visible:opacity-100">
          <Trash2 />
        </Button>
      </div>
      <div className="mt-2 pl-6 text-xs text-muted-foreground">
        {problem ? <span className="text-destructive">{problem}</span> : form.frequency === "custom" ? <>{describeCron(cron, offset)} · cron runs in UTC</> : <>Stored as <code className="font-mono">{cron}</code> (UTC)</>}
        {t.schedule?.name && <> · schedule “{t.schedule.name}”</>}
      </div>
    </div>
  );
}

const SCHEDULE_PRESETS: { label: string; frequency: Frequency }[] = [
  { label: "Hourly", frequency: "hourly" },
  { label: "Daily", frequency: "daily" },
  { label: "Weekly", frequency: "weekly" },
  { label: "Custom (cron)", frequency: "custom" },
];

function NotConnected() {
  return <span className="ml-auto rounded border px-1 text-[11px] font-medium text-muted-foreground">Not connected</span>;
}

/** "+ Add trigger" menu: Scheduled, Webhook, then every provider with its grouped events. */
export function AddTriggerMenu({ onAdd, ctx }: { onAdd: (t: TriggerModel) => void; ctx: TriggerContext }) {
  const offset = typeof window === "undefined" ? 0 : localOffset();
  const schedule = (frequency: Frequency) => {
    const cron = frequency === "custom" ? "0 9 * * *" : cronFromSchedule({ frequency, minute: 0, hour: 9, day: 1, cron: "" }, offset);
    onAdd(newTrigger("schedule", "cron_fired", cron));
  };
  const providers = PROVIDERS.filter((p) => !["schedule", "webhook"].includes(p.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-b-xl px-4 py-3 text-left text-sm text-foreground/80 outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
        <Plus className="size-4" /> Add trigger
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-62">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ProviderIcon provider="schedule" /> Scheduled
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44">
            {SCHEDULE_PRESETS.map((s) => (
              <DropdownMenuItem key={s.frequency} onClick={() => schedule(s.frequency)}>
                {s.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ProviderIcon provider="webhook" /> Webhook
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {ctx.webhooks.map((w) => (
              <DropdownMenuItem key={w.uid} onClick={() => onAdd({ ...newTrigger("webhook", "received"), webhook: w.uid })}>
                {w.name}
              </DropdownMenuItem>
            ))}
            {ctx.webhooks.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => window.open(`/f/${ctx.factory}/webhooks?new=1`, "_blank")}>
              <Plus /> New webhook
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {providers.map((p) => {
          const connected = !p.integration || ctx.connected.includes(p.integration);
          return (
            <DropdownMenuSub key={p.id}>
              <DropdownMenuSubTrigger className={cn(!connected && "text-muted-foreground")}>
                <ProviderIcon provider={p.id} /> <span className="truncate">{p.label}</span>
                {!connected && <NotConnected />}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-[70vh] w-64 overflow-y-auto">
                {!connected && (
                  <>
                    <DropdownMenuLabel className="font-normal">{p.label} is not connected. Triggers save, but fire only after you connect it in Integrations.</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                {groupedEvents(p).map((g, i) => (
                  <div key={g.group ?? i}>
                    {g.group && <DropdownMenuLabel className="font-semibold text-foreground">{g.group}</DropdownMenuLabel>}
                    {g.events.map((e) => (
                      <DropdownMenuItem key={e.id} onClick={() => onAdd(newTrigger(p.id, e.id))}>
                        {e.label}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TriggersCard({ triggers, onChange, ctx }: { triggers: TriggerModel[]; onChange: (t: TriggerModel[]) => void; ctx: TriggerContext }) {
  // Stable row keys so row state (open filters, custom cron text) follows its trigger.
  const counter = useRef(triggers.length);
  const [keys, setKeys] = useState(() => triggers.map((_, i) => i));
  const rowKeys = keys.length === triggers.length ? keys : triggers.map((_, i) => i);
  return (
    <div className="rounded-xl border">
      <div className="divide-y">
        {triggers.map((t, i) => {
          const update = (n: TriggerModel) => onChange(triggers.map((x, j) => (j === i ? n : x)));
          const remove = () => {
            setKeys(rowKeys.filter((_, j) => j !== i));
            onChange(triggers.filter((_, j) => j !== i));
          };
          return t.provider === "schedule" ? <ScheduleTriggerRow key={rowKeys[i]} t={t} update={update} remove={remove} /> : <EventTriggerRow key={rowKeys[i]} index={i} t={t} update={update} remove={remove} ctx={ctx} />;
        })}
      </div>
      <div className={cn(triggers.length > 0 && "border-t")}>
        <AddTriggerMenu
          ctx={ctx}
          onAdd={(t) => {
            setKeys([...rowKeys, ++counter.current]);
            onChange([...triggers, t]);
          }}
        />
      </div>
    </div>
  );
}
