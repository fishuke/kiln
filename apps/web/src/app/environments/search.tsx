"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EnvironmentSearch() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(Boolean(sp.get("q")));
  const set = (v?: string) => router.replace(v ? `${path}?q=${encodeURIComponent(v)}` : path);
  if (!open)
    return (
      <Button variant="outline" size="icon" aria-label="Search environments" onClick={() => setOpen(true)}>
        <Search className="text-muted-foreground" />
      </Button>
    );
  return (
    <div className="flex h-8 w-64 items-center gap-2 rounded-lg border-2 border-foreground bg-background px-2">
      <Search className="size-4 text-muted-foreground" />
      <input autoFocus defaultValue={sp.get("q") ?? ""} placeholder="Search environments" onChange={(e) => set(e.target.value || undefined)} onKeyDown={(e) => e.key === "Escape" && (set(), setOpen(false))} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      <button type="button" aria-label="Clear search" onClick={() => (set(), setOpen(false))} className="text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
