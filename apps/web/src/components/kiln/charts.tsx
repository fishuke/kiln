"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { InfoTip } from "@/components/kiln/info-tip";
import { areaPath, dayLabel, labelIndexes, linePath, niceScale, scaleLinear, stack, type Row } from "@/lib/chart";
import { cn } from "@/lib/utils";

/** Mid-tone series colors that read on light and dark backgrounds. */
export const SERIES_COLORS = ["#8b5cf6", "#ea580c", "#db2777", "#16a34a", "#2563eb", "#0d9488", "#d97706", "#64748b", "#c026d3", "#0891b2"];

export type Series = { key: string; label: string; color: string };
export type ValueFormat = "count" | "usd";

export const fmtValue = (v: number, f: ValueFormat) => (f === "usd" ? `$${v.toFixed(2)}` : Number.isInteger(v) ? String(v) : v.toFixed(1));

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e!.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Day-bucketed line, area or stacked-area chart with gridlines, axes and a hover cursor + tooltip. */
export function TimeChart({ rows, series, kind = "line", format = "count", height = 240, emptyText }: { rows: Row[]; series: Series[]; kind?: "line" | "area" | "stacked"; format?: ValueFormat; height?: number; emptyText?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const keys = series.map((s) => s.key);
  const stacked = useMemo(() => (kind === "stacked" ? stack(rows, keys) : null), [kind, rows, keys]);
  const max = useMemo(() => {
    if (stacked) return Math.max(0, ...rows.map((_, i) => (keys.length ? stacked[keys[keys.length - 1]!]![i]![1] : 0)));
    return Math.max(0, ...rows.flatMap((r) => keys.map((k) => Number(r[k] ?? 0))));
  }, [rows, keys, stacked]);
  const scale = niceScale(max);
  const left = format === "usd" ? 56 : 28;
  const pad = { top: 10, right: 12, bottom: 26 };
  const x = scaleLinear([0, Math.max(1, rows.length - 1)], [left, width - pad.right]);
  const y = scaleLinear([0, scale.top], [height - pad.bottom, pad.top]);
  const labels = new Set(labelIndexes(rows.length, width < 520 ? 4 : 7));
  const pts = (k: string) => rows.map((r, i) => [x(i), y(Number(r[k] ?? 0))] as [number, number]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const bx = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - bx.left;
    if (rows.length < 1) return;
    const step = rows.length > 1 ? (width - pad.right - left) / (rows.length - 1) : 1;
    setHover(Math.min(rows.length - 1, Math.max(0, Math.round((px - left) / step))));
  };

  const h = hover !== null ? rows[hover] : undefined;
  const total = h ? keys.reduce((s, k) => s + Number(h[k] ?? 0), 0) : 0;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={width} height={height} className="block overflow-visible text-muted-foreground" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Chart">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill="currentColor">
              {format === "usd" ? `$${t.toFixed(2)}` : t}
            </text>
          </g>
        ))}
        {rows.map((r, i) =>
          labels.has(i) ? (
            <text key={r.key} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"} fontSize={12} fill="currentColor">
              {dayLabel(r.key)}
            </text>
          ) : null,
        )}
        {stacked
          ? series.map((s) => {
              const band = stacked[s.key]!;
              const upper = band.map(([, y1], i) => [x(i), y(y1)] as [number, number]);
              const lower = band.map(([y0], i) => [x(i), y(y0)] as [number, number]);
              return (
                <g key={s.key}>
                  <path d={areaPath(upper, lower)} fill={s.color} fillOpacity={0.3} />
                  <path d={linePath(upper)} fill="none" stroke={s.color} strokeWidth={1.5} />
                </g>
              );
            })
          : series.map((s) => (
              <g key={s.key}>
                {kind === "area" && <path d={areaPath(pts(s.key), rows.map((_, i) => [x(i), y(0)] as [number, number]))} fill={s.color} fillOpacity={0.3} />}
                <path d={linePath(pts(s.key))} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              </g>
            ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={height - pad.bottom} stroke="currentColor" strokeOpacity={0.4} />
            {series.map((s) => {
              const v = stacked ? stacked[s.key]![hover]![1] : Number(rows[hover]![s.key] ?? 0);
              return <circle key={s.key} cx={x(hover)} cy={y(v)} r={3.5} fill={s.color} stroke="var(--background)" strokeWidth={1.5} />;
            })}
          </g>
        )}
      </svg>
      {emptyText && max === 0 && <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-6 text-sm text-muted-foreground">{emptyText}</div>}
      {h && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md"
          style={x(hover!) > width * 0.6 ? { right: width - x(hover!) + 12 } : { left: x(hover!) + 12 }}
        >
          <div className="text-xs text-muted-foreground">{dayLabel(h.key)}</div>
          <div className="mt-1 font-semibold">
            {fmtValue(total, format)} total
          </div>
          <ul className="mt-1.5 space-y-1">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-xs">
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                <span className="truncate text-muted-foreground">{s.label}</span>
                <span className="ml-auto pl-3 font-medium tabular-nums">{fmtValue(Number(h[s.key] ?? 0), format)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Colored filled checkboxes that toggle series. */
export function Legend({ series, hidden, onToggle }: { series: Series[]; hidden: Set<string>; onToggle: (key: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5">
      {series.map((s) => {
        const on = !hidden.has(s.key);
        return (
          <button key={s.key} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(s.key)} className="flex items-center gap-1.5 text-sm">
            <span className="flex size-4 items-center justify-center rounded-[4px] border" style={on ? { background: s.color, borderColor: s.color } : undefined}>
              {on && <Check className="size-3 text-white" strokeWidth={3} />}
            </span>
            <span className="max-w-48 truncate">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function useHidden() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return [hidden, toggle] as const;
}

/** Dashboard card: title + "?" tooltip, big number, sub line, header controls and an optional disclosure footer. */
export function ChartCard({ title, tip, value, sub, controls, children, footer, className }: { title: string; tip?: string; value?: React.ReactNode; sub?: React.ReactNode; controls?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card", className)}>
      <div className="p-4 sm:px-4 sm:pt-5 sm:pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              {title}
              {tip && <InfoTip title={title}>{tip}</InfoTip>}
            </h3>
            {value !== undefined && <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>}
            {sub && <div className="mt-1 text-sm text-muted-foreground">{sub}</div>}
          </div>
          {controls && <div className="flex flex-col items-end gap-2">{controls}</div>}
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
      {footer}
    </section>
  );
}

/** The footer disclosure row ("Most expensive PRs · top 20 by attributed cost ›") that expands a table. */
export function Disclosure({ label, hint, children, defaultOpen = false }: { label: string; hint: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-sm hover:bg-muted/40">
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {hint}
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
