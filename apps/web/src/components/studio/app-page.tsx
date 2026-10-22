"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { FakeScenario } from "@/lib/studio/fake";
import { useStudioClient } from "./use-client";
import { Workspace } from "./workspace";

/** /studio/[app]: the workspace on the API (or the development fake; `seed` picks its data). */
export function AppPage({ appId, seed }: { appId: string; seed?: FakeScenario }) {
  const client = useStudioClient(seed);
  if (!client)
    return (
      <div className="flex h-screen flex-col gap-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="flex-1" />
      </div>
    );
  return <Workspace client={client} appId={appId} />;
}
