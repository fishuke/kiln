import Link from "next/link";
import { cn } from "@/lib/utils";

/** Automations / Webhooks / Pipelines switch shown above the automation area pages. */
export function AreaTabs({ factory, active }: { factory: string; active: "automations" | "webhooks" | "pipelines" }) {
  const tabs = [
    { id: "automations", label: "Automations", href: `/f/${factory}/automations` },
    { id: "webhooks", label: "Webhooks", href: `/f/${factory}/webhooks` },
    { id: "pipelines", label: "Pipelines", href: `/f/${factory}/pipelines` },
  ] as const;
  return (
    <nav aria-label="Automation area" className="mb-4 flex gap-1">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === active ? "page" : undefined}
          className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", t.id === active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
