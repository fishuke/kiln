import type { RouteContext } from "../app";
import { registerAutomationRoutes } from "./automations";
import { registerConnectionRoutes } from "./connections";
import { registerWebhookSourceRoutes } from "./webhook-sources";
import { registerWebhookRoutes } from "./webhooks";

/**
 * Route modules, one file per area. Each registers its routes on the app and lists them in
 * ../openapi.ts. Add a module here; keep app.ts for auth, webhooks and the core routes.
 */
const MODULES: ((ctx: RouteContext) => void)[] = [registerConnectionRoutes, registerAutomationRoutes, registerWebhookSourceRoutes];

/** Public routes (provider webhooks, OAuth callbacks): registered before the API's auth middleware. */
const PUBLIC_MODULES: ((ctx: RouteContext) => void)[] = [registerWebhookRoutes];

export function registerModules(ctx: RouteContext) {
  for (const register of MODULES) register(ctx);
}

export function registerPublicRoutes(ctx: RouteContext) {
  for (const register of PUBLIC_MODULES) register(ctx);
}
