import "server-only";
import { z } from "zod";
import { api, safe } from "@/lib/kiln";
import { MergeReview } from "@/lib/studio/types";
import type { StudioPrReview } from "./studio-pr-reviews";

/** App pull requests waiting for a person (`GET /merge-gate/reviews?state=needs_review`), with their App's name. */
export async function studioPrReviews(): Promise<StudioPrReview[]> {
  const [reviews, apps] = await Promise.all([
    safe(async () => z.object({ reviews: z.array(MergeReview) }).parse(await api.request("GET", "/api/v1/merge-gate/reviews?state=needs_review")).reviews, []),
    safe(async () => (await api.studioApps()).apps, []),
  ]);
  return reviews
    .filter((r) => r.scope.kind === "app")
    .map((review) => {
      const appId = review.scope.kind === "app" ? review.scope.appId : undefined;
      const app = apps.find((a) => a.id === appId);
      return { review, app: app ? { id: app.id, name: app.name } : undefined };
    });
}
