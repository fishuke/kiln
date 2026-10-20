import type { RouteContext } from "../app";
import { currentTeam } from "./platform-helpers";

/** Usage of the current team, from run costs: totals, the spend limit and breakdowns. */
export function usageRoutes(ctx: RouteContext) {
  const { app, kiln } = ctx;

  app.get("/api/v1/usage", (c) => {
    const { team } = currentTeam(ctx, c);
    const q = (k: string) => c.req.query(k) || undefined;
    const user = q("user");
    const userId = user ? (kiln.users.get(user)?.id ?? kiln.users.byEmail(user)?.id ?? user) : undefined;
    const filter = { since: q("since"), until: q("until"), factory: q("factory"), userId };
    const summary = kiln.usage.summary(team.id, filter);
    if (!q("entries")) return c.json(summary);
    return c.json({ ...summary, entries: kiln.usage.ledger(team.id, { ...filter, since: summary.since, until: summary.until }).slice(0, 1000) });
  });
}
