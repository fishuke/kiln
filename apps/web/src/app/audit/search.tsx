"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

export function AuditSearch() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  return (
    <div className="flex h-8 w-64 items-center gap-2 rounded-lg border bg-background px-2 focus-within:border-foreground">
      <Search className="size-4 text-muted-foreground" />
      <input
        defaultValue={sp.get("q") ?? ""}
        placeholder="Search actor, action or target"
        aria-label="Search the audit log"
        onChange={(e) => {
          const next = new URLSearchParams(sp);
          if (e.target.value) next.set("q", e.target.value);
          else next.delete("q");
          router.replace(`${path}${next.size ? `?${next}` : ""}`);
        }}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  );
}
