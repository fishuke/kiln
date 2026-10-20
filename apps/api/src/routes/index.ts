import type { RouteContext } from "../app";
import { authRoutes } from "./auth";
import * as benchmarks from "./benchmarks";
import * as definitions from "./definitions";
import { environmentRoutes } from "./environments";
import * as factories from "./factories";
import * as factoryFiles from "./factory-files";
import { factoryMemberRoutes } from "./factory-members";
import * as files from "./files";
import * as inbox from "./inbox";
import { mcpServerRoutes } from "./mcp-servers";
import { meRoutes } from "./me";
import * as measure from "./measure";
import * as runs from "./runs";
import * as scorers from "./scorers";
import { secretRoutes } from "./secrets";
import * as tasks from "./tasks";
import { teamRoutes } from "./teams";
import { usageRoutes } from "./usage";
import * as workers from "./workers";

/**
 * Route modules, one file per area. The factory-core modules export `register` and their
 * `routes` (listed in ../openapi.ts); the platform modules are registration functions whose
 * routes openapi.ts lists directly. Keep app.ts for auth, webhooks and the core routes.
 */
export const MODULES = [factoryFiles, files, tasks, runs, inbox, measure, scorers, benchmarks, definitions, factories, workers];
const PLATFORM: ((ctx: RouteContext) => void)[] = [authRoutes, meRoutes, teamRoutes, factoryMemberRoutes, secretRoutes, mcpServerRoutes, environmentRoutes, usageRoutes];

export function registerModules(ctx: RouteContext) {
  for (const register of PLATFORM) register(ctx);
  for (const m of MODULES) m.register(ctx);
}
