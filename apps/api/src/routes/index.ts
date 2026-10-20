import type { RouteContext } from "../app";
import * as benchmarks from "./benchmarks";
import * as definitions from "./definitions";
import * as factories from "./factories";
import * as factoryFiles from "./factory-files";
import * as files from "./files";
import * as inbox from "./inbox";
import * as measure from "./measure";
import * as runs from "./runs";
import * as scorers from "./scorers";
import * as tasks from "./tasks";
import * as workers from "./workers";

/**
 * Route modules, one file per area. Each registers its routes on the app and exports `routes`,
 * which ../openapi.ts lists. Add a module here; keep app.ts for auth, webhooks and the core routes.
 */
export const MODULES = [factoryFiles, files, tasks, runs, inbox, measure, scorers, benchmarks, definitions, factories, workers];

export function registerModules(ctx: RouteContext) {
  for (const m of MODULES) m.register(ctx);
}
