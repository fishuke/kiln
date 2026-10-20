import { cn } from "@/lib/utils";

/**
 * The settings visual language (factory Settings, user Settings, Team settings): a single
 * 820px column of titled sections, each a muted card, with an anchor list on wide screens.
 */
export function SettingsColumn({ nav, children, title }: { nav?: { id: string; label: string }[]; title?: string; children: React.ReactNode }) {
  return (
    <div className="relative px-6 pt-8 pb-24">
      {nav && nav.length > 0 && (
        <nav aria-label="On this page" className="absolute top-10 left-6 hidden w-44 2xl:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {nav.map((n) => (
              <li key={n.id}>
                <a href={`#${n.id}`} className="block rounded-md px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="mx-auto w-full max-w-[820px]">
        {title && <h1 className="mb-8 text-2xl font-semibold tracking-tight">{title}</h1>}
        {children}
      </div>
    </div>
  );
}

export function SettingsSection({ id, title, action, children, className }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <div className="mb-3 flex min-h-8 items-end justify-between gap-4">
        <h2 className="text-lg font-medium text-foreground/70">{title}</h2>
        {action}
      </div>
      <div className={cn("rounded-xl border bg-muted/60 p-6 dark:bg-muted/30", className)}>{children}</div>
    </section>
  );
}

/** A labelled block inside a section card: title, helper text, optional meta on the right, then the control. */
export function Field({ label, description, meta, children, className, htmlFor }: { label: React.ReactNode; description?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("space-y-2 [&+&]:mt-6", className)}>
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor={htmlFor} className="text-sm font-semibold">
            {label}
          </label>
          {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Label column (200px) plus control, as in "Agent defaults". */
export function SettingsRow({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 py-2 sm:grid-cols-[200px_1fr]">
      <div className="text-sm font-semibold">
        {label}
        {hint && <div className="text-xs font-normal text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A row with a logo, title, description and a right-side action (integrations, danger zone, runners). */
export function ActionRow({ icon, title, description, children, className }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 [&+&]:mt-5", className)}>
      {icon && <div className="flex size-10 shrink-0 items-center justify-center">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function ConnectedBadge({ children = "Connected", tone = "green" }: { children?: React.ReactNode; tone?: "green" | "grey" | "amber" | "red" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone === "green" && "border-green-600/25 bg-green-500/10 text-green-700 dark:text-green-400",
        tone === "grey" && "border-border bg-background text-muted-foreground",
        tone === "amber" && "border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "red" && "border-destructive/25 bg-destructive/10 text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", tone === "green" ? "bg-green-500" : tone === "amber" ? "bg-amber-500" : tone === "red" ? "bg-destructive" : "bg-muted-foreground/60")} />
      {children}
    </span>
  );
}

/** The large grey panel used for empty lists (Secrets, Environments). */
export function EmptyPanel({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mx-4 mb-4 flex min-h-[calc(100vh-4.5rem)] flex-col items-center justify-center rounded-lg bg-muted px-6 text-center">
      <div className="text-base font-semibold text-foreground/70">{title}</div>
      {children && <div className="mt-1 max-w-xl text-sm text-muted-foreground">{children}</div>}
      {actions && <div className="mt-4 flex gap-3">{actions}</div>}
    </div>
  );
}

/** Small centered empty state with an icon circle (MCPs and apps). */
export function EmptyIcon({ icon, title, children, action, className }: { icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[60vh] flex-col items-center justify-center px-6 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full border text-muted-foreground">{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="mt-1 max-w-md text-xs text-muted-foreground">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Two-line avatar fallback: an image when there is one, otherwise the first letter. */
export function AvatarBox({ src, name, className, square }: { src?: string; name: string; className?: string; square?: boolean }) {
  const shape = square ? "rounded-lg" : "rounded-full";
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt="" className={cn("size-8 shrink-0 object-cover", shape, className)} />;
  return <span className={cn("flex size-8 shrink-0 items-center justify-center bg-foreground/10 text-sm font-medium uppercase", shape, className)}>{name.slice(0, 1) || "?"}</span>;
}
