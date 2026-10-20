"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { FactoryAvatar } from "@/components/kiln/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PickerFactory = { id: string; name: string; alias?: string };

/** "Kiln ⌄" factory selector with a search field and a check on the selected factory. */
export function FactoryPicker({ factories, value, onChange }: { factories: PickerFactory[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = factories.find((f) => f.id === value);
  const shown = factories.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o || setQ(""))}>
      <PopoverTrigger aria-label="Select factory" className="flex h-7 items-center gap-1 rounded-md px-1.5 text-sm font-semibold hover:bg-muted aria-expanded:bg-muted">
        {current?.name ?? "Choose a factory"}
        <ChevronDown className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-62 gap-1 p-1">
        <div className="flex h-9 items-center gap-2 rounded-md px-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search factories" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        <div role="radiogroup" className="mt-1 flex flex-col">
          {shown.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">No factories</div>}
          {shown.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={f.id === value}
              onClick={() => {
                onChange(f.id);
                setOpen(false);
              }}
              className={cn("flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm font-medium hover:bg-muted")}
            >
              <FactoryAvatar name={f.name} />
              <span className="flex-1 truncate">{f.name}</span>
              {f.id === value && <Check className="size-4 text-violet-600 dark:text-violet-400" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
