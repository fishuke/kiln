import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { stateLabel, stateTone } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PageHeader({ crumbs, actions }: { crumbs: { label: string; href?: string }[]; actions?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/95 px-6 backdrop-blur">
      <nav className="flex min-w-0 items-center gap-2 text-sm">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-2">
            {i > 0 && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            {c.href ? (
              <Link href={c.href} className="truncate text-muted-foreground hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className="truncate font-medium">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Page({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  return <div className={cn("mx-auto w-full px-6 py-8", narrow ? "max-w-3xl" : "max-w-6xl")}>{children}</div>;
}

export function Section({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StateBadge({ state }: { state: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", stateTone(state))}>{stateLabel(state)}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed px-6 py-10 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em]">{children}</code>;
}

export function Pre({ children, className }: { children: React.ReactNode; className?: string }) {
  return <pre className={cn("overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap", className)}>{children}</pre>;
}

export function ApiDown({ error }: { error?: string }) {
  return (
    <Page narrow>
      <Empty title="Kiln API is not reachable">
        Start it with <Code>pnpm dev:api</Code> (port 4000), or set <Code>KILN_API_URL</Code> and <Code>KILN_TOKEN</Code>.{error ? ` (${error})` : ""}
      </Empty>
    </Page>
  );
}
