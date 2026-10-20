"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { ProviderIcon } from "@/components/kiln/provider-icon";
import { TEMPLATE_CATEGORIES, type AutomationTemplate, type TemplateCategory } from "@/lib/automations/templates";
import { cn } from "@/lib/utils";

export function Suggestions({ factory, templates }: { factory: string; templates: AutomationTemplate[] }) {
  const [cat, setCat] = useState<TemplateCategory>("suggested");
  const shown = templates.filter((t) => t.categories.includes(cat));
  return (
    <section className="mt-6" aria-label="Suggested automations">
      <div className="mb-4 flex flex-wrap gap-2.5">
        {TEMPLATE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === cat}
            onClick={() => setCat(c.id)}
            className={cn("h-9 rounded-lg border px-3.5 text-sm font-medium transition-colors", c.id === cat ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((t) => (
          <Link
            key={t.slug}
            href={`/f/${factory}/automations/new?suggestion=${encodeURIComponent(t.slug)}&variant=github`}
            aria-label={`Add suggested automation: ${t.title}`}
            className="group flex flex-col rounded-xl border bg-background p-6 transition-colors hover:bg-muted/40"
          >
            <span className="mb-3 flex items-center gap-1 text-muted-foreground">
              <ProviderIcon provider={t.source} />
              <ChevronRight className="size-3" />
              <ProviderIcon provider={t.target} />
            </span>
            <span className="text-sm font-semibold">{t.title}</span>
            <span className="mt-1 flex-1 text-sm text-muted-foreground">{t.description}</span>
            <span className="mt-4 inline-flex h-8 w-fit items-center rounded-lg border bg-background px-3 text-sm font-medium group-hover:bg-muted">Add</span>
          </Link>
        ))}
        {!shown.length && <p className="text-sm text-muted-foreground">No suggestions in this category.</p>}
      </div>
    </section>
  );
}
