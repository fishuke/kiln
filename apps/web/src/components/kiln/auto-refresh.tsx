"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server component on an interval while work is in flight. */
export function AutoRefresh({ ms = 3000, enabled = true }: { ms?: number; enabled?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [router, ms, enabled]);
  return null;
}
