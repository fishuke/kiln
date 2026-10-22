"use client";

import type { FakeScenario } from "@/lib/studio/fake";
import { useStudioClient } from "./use-client";
import { Workspace } from "./workspace";

/** /studio/[app] on the API, or on the in-memory fake (`seed` picks its starting data). */
export function AppPage({ appId, fake, seed }: { appId: string; fake: boolean; seed?: FakeScenario }) {
  const client = useStudioClient(fake, seed);
  return <Workspace client={client} appId={appId} />;
}
