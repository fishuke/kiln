"use client";

import { useState } from "react";
import { SimpleSelect } from "@/components/kiln/simple-select";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { install, publish } from "./actions";

export function PublishButton({ factory, name }: { factory: string; name: string }) {
  const [pending, run] = useAction();
  return (
    <Button variant="outline" disabled={pending} onClick={() => void run(() => publish(factory, name))}>
      {pending ? "Publishing…" : "Publish"}
    </Button>
  );
}

export function InstallControl({ listingId, factories }: { listingId: string; factories: { id: string; name: string }[] }) {
  const [factory, setFactory] = useState(factories[0]?.id ?? "");
  const [pending, run] = useAction();
  if (factories.length === 0) return <span className="text-xs text-muted-foreground">In every factory</span>;
  return (
    <div className="flex items-center gap-2">
      <SimpleSelect size="sm" className="w-36" value={factory} onChange={setFactory} options={factories.map((f) => ({ value: f.id, label: f.name }))} ariaLabel="Factory to install into" />
      <Button size="sm" disabled={pending || !factory} onClick={() => void run(() => install(listingId, factory))}>
        {pending ? "Installing…" : "Install"}
      </Button>
    </div>
  );
}
