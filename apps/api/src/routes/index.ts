import type { RouteContext } from "../app";
import { authRoutes } from "./auth";
import { environmentRoutes } from "./environments";
import { factoryMemberRoutes } from "./factory-members";
import { mcpServerRoutes } from "./mcp-servers";
import { meRoutes } from "./me";
import { secretRoutes } from "./secrets";
import { teamRoutes } from "./teams";
import { usageRoutes } from "./usage";

/**
 * Route modules, one file per area. Each registers its routes on the app and lists them in
 * ../openapi.ts. Add a module here; keep app.ts for auth, webhooks and the core routes.
 */
const MODULES: ((ctx: RouteContext) => void)[] = [authRoutes, meRoutes, teamRoutes, factoryMemberRoutes, secretRoutes, mcpServerRoutes, environmentRoutes, usageRoutes];

export function registerModules(ctx: RouteContext) {
  for (const register of MODULES) register(ctx);
}
