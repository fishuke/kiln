"use client";

import { useEffect, useState } from "react";
import { ApiStudioClient } from "@/lib/studio/api-client";
import type { StudioClient } from "@/lib/studio/client";
import type { FakeScenario } from "@/lib/studio/fake";

/** One fake per browser tab, so moving between /studio pages keeps its state. */
let fake: StudioClient | undefined;

/**
 * The page's Studio client: the API, or the in-memory fake when the web was built or started with
 * NEXT_PUBLIC_KILN_STUDIO_FAKE=1. The flag is inlined at build time, so without it the fake's
 * import is dead code and the fake isn't in the bundle. Undefined while the fake loads.
 */
export function useStudioClient(seed: FakeScenario = "demo"): StudioClient | undefined {
  const [client, setClient] = useState<StudioClient | undefined>(() => (process.env.NEXT_PUBLIC_KILN_STUDIO_FAKE === "1" ? fake : new ApiStudioClient()));
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_KILN_STUDIO_FAKE === "1") {
      if (fake) return setClient(fake);
      void import("@/lib/studio/fake").then(({ FakeStudioClient }) => {
        const f = new FakeStudioClient();
        f.seed(seed);
        fake = f;
        setClient(f);
      });
    }
  }, [seed]);
  return client;
}
