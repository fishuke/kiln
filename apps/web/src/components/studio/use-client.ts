"use client";

import { useMemo } from "react";
import { ApiStudioClient } from "@/lib/studio/api-client";
import type { StudioClient } from "@/lib/studio/client";
import { FakeStudioClient, type FakeScenario } from "@/lib/studio/fake";

/** One fake per browser tab, so moving between /studio pages keeps its state. */
let fake: FakeStudioClient | undefined;

/** The page's Studio client: the API, or the in-memory fake when KILN_STUDIO_FAKE=1. */
export function useStudioClient(useFake: boolean, seed: FakeScenario = "demo"): StudioClient {
  return useMemo(() => {
    if (!useFake) return new ApiStudioClient();
    if (!fake) {
      fake = new FakeStudioClient();
      fake.seed(seed);
    }
    return fake;
  }, [useFake, seed]);
}
