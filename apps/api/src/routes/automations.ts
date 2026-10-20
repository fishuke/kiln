import { AUTOMATION_TEMPLATES, renderTemplates } from "@kiln/engine";
import { FILTER_DEFAULTS, TRIGGER_CATALOG } from "@kiln/schema";
import { HttpError, type RouteContext } from "../app";
import { FromTemplate, TestFilter } from "./integration-schemas";

export function registerAutomationRoutes({ app, kiln, need, who }: RouteContext) {
  /** Ready automation files: defaults per connected tool and setup suggestions, filled in for a factory. */
  app.get("/api/v1/automation-templates", (c) => {
    const factory = c.req.query("factory");
    const category = c.req.query("category");
    let templates = AUTOMATION_TEMPLATES;
    if (factory) {
      need(c, "read", factory);
      const def = kiln.defs.current(factory).factory;
      const linear = def.integrations.find((i) => i.type === "linear")?.linear;
      const jira = def.integrations.find((i) => i.type === "jira")?.jira;
      templates = renderTemplates({ alias: def.alias ?? factory, linearTeams: linear?.teams ?? linear?.teamIds, jiraProjects: jira?.projects ?? jira?.projectKeys });
    }
    const connected = new Set(kiln.connections.list().filter((p) => p.connection?.status === "connected").map((p) => p.provider));
    return c.json(templates.filter((t) => !category || t.category === category).map((t) => ({ ...t, connected: t.requires.every((r) => connected.has(r as never)) })));
  });

  /** Add a template to a Kiln-managed factory and apply it. */
  app.post("/api/v1/factories/:id/automations/from-template", async (c) => {
    const id = c.req.param("id");
    need(c, "definitions:write", id);
    const b = kiln.defs.require(id);
    const body = FromTemplate.parse(await c.req.json());
    const def = kiln.defs.current(id).factory;
    const linear = def.integrations.find((i) => i.type === "linear")?.linear;
    const jira = def.integrations.find((i) => i.type === "jira")?.jira;
    const tpl = renderTemplates({ alias: def.alias ?? id, linearTeams: linear?.teams, jiraProjects: jira?.projects }).find((t) => t.id === body.template);
    if (!tpl) throw new HttpError(404, `unknown template ${body.template}`);
    const files = Object.fromEntries(Object.entries(tpl.files).map(([path, src]) => [body.name ? path.replace(`automations/${tpl.id}/`, `automations/${body.name}/`) : path, src]));
    if (b.definitionRepo) return c.json({ applied: false, files, reason: `${id} is defined in ${b.definitionRepo.owner}/${b.definitionRepo.name}: add these files there` });
    const tree = { ...kiln.defs.tree(b.appliedSha!)!, ...files };
    const r = kiln.defs.apply(tree, { author: who(c), factory: id });
    return c.json({ ...r, applied: r.ok, files }, r.ok ? 200 : 400);
  });

  /** Every provider, event and filter key automations accept, with each key's matcher kind. */
  app.get("/api/v1/automation-catalog", (c) => c.json({ providers: TRIGGER_CATALOG, defaults: FILTER_DEFAULTS }));

  /** Recent provider deliveries (to pick one for Test filter). */
  app.get("/api/v1/deliveries", (c) => {
    need(c, "admin", "*");
    return c.json(kiln.automations.deliveries({ provider: c.req.query("provider"), limit: Number(c.req.query("limit") ?? 50) }));
  });

  /** "Run now": start an automation by hand with its prompt and overrides. */
  app.post("/api/v1/factories/:id/automations/:name/run", async (c) => {
    const { id, name } = c.req.param();
    need(c, "send", id);
    const wi = await kiln.automations.runNow(id, name, who(c));
    return c.json({ workItemId: wi.id, ...(wi.deduplicated ? { deduplicated: wi.deduplicated } : {}) }, wi.deduplicated ? 200 : 201);
  });

  /** "Test filter": evaluate an automation's triggers against a stored delivery. */
  app.post("/api/v1/factories/:id/automations/:name/test-filter", async (c) => {
    const { id, name } = c.req.param();
    need(c, "read", id);
    const { deliveryId } = TestFilter.parse(await c.req.json());
    return c.json(kiln.automations.testFilter(id, name, deliveryId));
  });
}
