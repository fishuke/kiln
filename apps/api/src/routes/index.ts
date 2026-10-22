import type { RouteContext } from "../app";
import { authRoutes } from "./auth";
import { registerAutomationRoutes } from "./automations";
import * as benchmarks from "./benchmarks";
import { registerConnectionRoutes } from "./connections";
import * as definitions from "./definitions";
import { environmentRoutes } from "./environments";
import * as factories from "./factories";
import { factoryDeleteRoutes } from "./factory-delete";
import * as factoryFiles from "./factory-files";
import { factoryMemberRoutes } from "./factory-members";
import * as files from "./files";
import * as inbox from "./inbox";
import { mcpServerRoutes } from "./mcp-servers";
import { meRoutes } from "./me";
import * as measure from "./measure";
import * as reviews from "./reviews";
import * as runs from "./runs";
import * as scorers from "./scorers";
import { secretRoutes } from "./secrets";
import { registerStudioPreview } from "./studio-preview";
import * as tasks from "./tasks";
import { teamRoutes } from "./teams";
import { usageRoutes } from "./usage";
import { variableRoutes } from "./variables";
import { registerWebhookSourceRoutes } from "./webhook-sources";
import { registerWebhookRoutes } from "./webhooks";
import * as workers from "./workers";
import { registerGitHubAppCallbacks, registerGitHubAppRoutes } from "./github-app";
import { registerOAuthConsent, registerOAuthServer } from "./oauth";

/**
 * Route modules, one file per area. The factory-core modules export `register` and their
 * `routes` (listed in ../openapi.ts); the platform and integration modules are registration
 * functions whose routes openapi.ts lists directly. Keep app.ts for auth and the core routes.
 */
export const MODULES = [factoryFiles, files, tasks, reviews, runs, inbox, measure, scorers, benchmarks, definitions, factories, workers];
const PLATFORM: ((ctx: RouteContext) => void)[] = [
  authRoutes,
  meRoutes,
  teamRoutes,
  factoryMemberRoutes,
  secretRoutes,
  mcpServerRoutes,
  environmentRoutes,
  variableRoutes,
  usageRoutes,
  registerConnectionRoutes,
  registerGitHubAppRoutes,
  registerOAuthConsent,
  registerAutomationRoutes,
  registerWebhookSourceRoutes,
  factoryDeleteRoutes,
];

/** Public routes (Studio preview hosts, provider webhooks, OAuth callbacks): registered before the API's auth middleware. */
const PUBLIC_MODULES: ((ctx: RouteContext) => void)[] = [registerStudioPreview, registerWebhookRoutes, registerGitHubAppCallbacks, registerOAuthServer];

export function registerModules(ctx: RouteContext) {
  for (const register of PLATFORM) register(ctx);
  for (const m of MODULES) m.register(ctx);
}

export function registerPublicRoutes(ctx: RouteContext) {
  for (const register of PUBLIC_MODULES) register(ctx);
}
