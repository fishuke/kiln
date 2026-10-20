"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { answer } from "./actions";

export function ConsentButtons({ params }: { params: Record<string, string> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const go = (approve: boolean) =>
    start(async () => {
      const r = await answer(params, approve);
      if (r?.error) setError(r.error);
    });
  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button className="flex-1" disabled={pending} onClick={() => go(true)}>
          {pending ? "Connecting…" : "Allow"}
        </Button>
        <Button variant="outline" className="flex-1" disabled={pending} onClick={() => go(false)}>
          Deny
        </Button>
      </div>
    </div>
  );
}
