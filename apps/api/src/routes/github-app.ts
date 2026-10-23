import { KilnError } from "@kiln/engine";
import { z } from "zod";
import type { RouteContext } from "../app";
import { urls } from "./util";

export const GitHubAppStart = z.object({ org: z.string().min(1).optional(), name: z.string().min(1).max(34).optional() }).strict();

/** Admin: the manifest for Kiln's own GitHub App, and its status. */
export function registerGitHubAppRoutes({ app, kiln, need, who }: RouteContext) {
  app.post("/api/v1/connections/github/app-manifest", async (c) => {
    need(c, "admin", "*");
    const text = await c.req.text();
    return c.json(kiln.githubApp.start(who(c), GitHubAppStart.parse(text ? JSON.parse(text) : {})));
  });
  app.get("/api/v1/connections/github/app", (c) => {
    need(c, "admin", "*");
    return c.json(kiln.githubApp.info() ?? null);
  });
  app.get("/api/v1/connections/github/apps", (c) => {
    need(c, "admin", "*");
    return c.json(kiln.githubApp.list());
  });
  app.delete("/api/v1/connections/github/apps/:slug", (c) => {
    need(c, "admin", "*");
    kiln.githubApp.remove(c.req.param("slug"), who(c));
    return c.body(null, 204);
  });
}

/** GitHub's browser redirects after Create and after Install. Public; the single-use state is the check. */
export function registerGitHubAppCallbacks({ app, kiln }: RouteContext) {
  const web = () => (kiln.options.webUrl ?? kiln.options.publicUrl ?? "").replace(/\/$/, "");
  const fail = (err: unknown) => `${web()}/integrations?provider=github&error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`;

  app.get("/oauth/github/app/callback", async (c) => {
    try {
      const { installUrl } = await kiln.githubApp.created(c.req.query("code") ?? "", c.req.query("state") ?? "");
      return c.redirect(installUrl, 302);
    } catch (err) {
      if (!(err instanceof KilnError)) kiln.audit("kiln", "github_app.failed", "create", { error: String(err) });
      return c.redirect(fail(err), 302);
    }
  });

  app.get("/oauth/github/app/installed", async (c) => {
    try {
      const installationId = c.req.query("installation_id") ?? "";
      if (!/^\d+$/.test(installationId)) throw new KilnError("invalid_request", "GitHub did not say which installation was made");
      const { by } = kiln.githubApp.installed(installationId, c.req.query("state") ?? "");
      // The first app makes the GitHub connection; later ones (other accounts and organizations) join it.
      const connected = kiln.connections.list().find((p) => p.provider === "github")?.connection?.status === "connected";
      if (!connected) await kiln.connections.complete("github", { params: { installation_id: installationId }, by, ...urls(kiln, c, "github") });
      return c.redirect(`${web()}/integrations?provider=github&connected=1`, 302);
    } catch (err) {
      return c.redirect(fail(err), 302);
    }
  });
}
