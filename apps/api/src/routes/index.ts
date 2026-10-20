import type { RouteContext } from "../app";

/**
 * Route modules, one file per area. Each registers its routes on the app and lists them in
 * ../openapi.ts. Add a module here; keep app.ts for auth, webhooks and the core routes.
 */
const MODULES: ((ctx: RouteContext) => void)[] = [];

export function registerModules(ctx: RouteContext) {
  for (const register of MODULES) register(ctx);
}
