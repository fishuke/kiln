import type { RouteContext } from "../app";
import { authRoutes } from "./auth";
import { environmentRoutes } from "./environments";
import { factoryMemberRoutes } from "./factory-members";
import { mcpServerRoutes } from "./mcp-servers";
import { meRoutes } from "./me";
import { secretRoutes } from "./secrets";
import { teamRoutes } from "./teams";
import { usageRoutes } from "./usage";
import { registerAutomationRoutes } from "./automations";
import { registerConnectionRoutes } from "./connections";
import { registerWebhookSourceRoutes } from "./webhook-sources";
import { registerWebhookRoutes } from "./webhooks";
import { factoryDeleteRoutes } from "./factory-delete";

/**
 * Route modules, one file per area. Each registers its routes on the app and lists them in
 * ../openapi.ts. Add a module here; keep app.ts for auth, webhooks and the core routes.
 */
const MODULES: ((ctx: RouteContext) => void)[] = [authRoutes, meRoutes, teamRoutes, factoryMemberRoutes, secretRoutes, mcpServerRoutes, environmentRoutes, usageRoutes, registerConnectionRoutes, registerAutomationRoutes, registerWebhookSourceRoutes, factoryDeleteRoutes];

/** Public routes (provider webhooks, OAuth callbacks): registered before the API's auth middleware. */
const PUBLIC_MODULES: ((ctx: RouteContext) => void)[] = [registerWebhookRoutes];

export function registerModules(ctx: RouteContext) {
  for (const register of MODULES) register(ctx);
}

export function registerPublicRoutes(ctx: RouteContext) {
  for (const register of PUBLIC_MODULES) register(ctx);
}
