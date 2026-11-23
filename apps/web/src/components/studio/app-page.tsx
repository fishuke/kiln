"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { FakeScenario } from "@/lib/studio/fake";
import { useStudioClient } from "./use-client";
import { Workspace } from "./workspace";

function Loading() {
  return (
    <div className="flex h-screen flex-col gap-3 p-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="flex-1" />
    </div>
  );
}

/** The Context page and its editor load only when the flag is on, so the current page's bundle stays as it is. */
const ContextWorkspace = dynamic(() => import("./context/context-workspace").then((m) => m.ContextWorkspace), { ssr: false, loading: Loading });

/**
 * /studio/[app]: the workspace on the API (or the development fake; `seed` picks its data). With
 * `context` (KILN_STUDIO_CONTEXT=1) and a client that has the Context methods, the Context page.
 */
export function AppPage({ appId, seed, context }: { appId: string; seed?: FakeScenario; context?: boolean }) {
  const client = useStudioClient(seed);
  if (!client) return <Loading />;
  if (context && client.context) return <ContextWorkspace client={client} context={client.context} appId={appId} />;
  return <Workspace client={client} appId={appId} />;
}
