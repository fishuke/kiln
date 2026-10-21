import type { RunError } from "./types";

export type ErrorSpec = { http: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500; retryable: boolean | "automatic"; state: "FAILED" | "ERROR"; title: string };

/**
 * Every error a run or an API call can end with. User-side errors (`FAILED`) mean the task
 * cannot be done as asked; platform errors (`ERROR`) mean Kiln or its infrastructure failed.
 * Errors marked `automatic` are retried by Kiln before the run is reported.
 */
export const ERROR_CATALOG: Record<string, ErrorSpec> = {
  insufficient_credits: { http: 403, retryable: false, state: "FAILED", title: "Not enough credits or provider quota" },
  feature_not_available: { http: 403, retryable: false, state: "FAILED", title: "The feature is not available on this install" },
  external_authentication_required: { http: 401, retryable: false, state: "FAILED", title: "An external account must be connected" },
  not_authorized: { http: 403, retryable: false, state: "FAILED", title: "Not authorized" },
  invalid_request: { http: 400, retryable: false, state: "FAILED", title: "Invalid request" },
  resource_not_found: { http: 404, retryable: false, state: "FAILED", title: "Resource not found" },
  budget_exceeded: { http: 403, retryable: false, state: "FAILED", title: "Budget exceeded" },
  integration_disabled: { http: 403, retryable: false, state: "FAILED", title: "Integration disabled" },
  integration_not_configured: { http: 400, retryable: false, state: "FAILED", title: "Integration not configured" },
  operation_not_supported: { http: 422, retryable: false, state: "FAILED", title: "Operation not supported" },
  environment_setup_failed: { http: 500, retryable: false, state: "FAILED", title: "Environment setup failed" },
  content_policy_violation: { http: 403, retryable: false, state: "FAILED", title: "Content policy violation" },
  conflict: { http: 409, retryable: true, state: "FAILED", title: "Conflict" },
  authentication_required: { http: 401, retryable: false, state: "ERROR", title: "Authentication required" },
  resource_unavailable: { http: 429, retryable: "automatic", state: "ERROR", title: "Resource temporarily unavailable" },
  internal_error: { http: 500, retryable: "automatic", state: "ERROR", title: "Internal error" },
  infrastructure_timeout: { http: 500, retryable: false, state: "ERROR", title: "Infrastructure timeout" },
  agent_process_failed: { http: 500, retryable: false, state: "ERROR", title: "The agent process failed" },
  interrupted_by_restart: { http: 500, retryable: false, state: "ERROR", title: "Kiln restarted while the run was going" },
};

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** An error with a catalog code. The API turns it into a problem document with the code's HTTP status. */
export class KilnError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }

  get spec(): ErrorSpec {
    return ERROR_CATALOG[this.code] ?? ERROR_CATALOG.internal_error!;
  }
}

const PATTERNS: [RegExp, ErrorCode, Record<string, unknown>?][] = [
  [/monthly budget|budget of \$/i, "budget_exceeded"],
  [/insufficient (credits|quota)|credit balance|quota exceeded|billing/i, "insufficient_credits"],
  [/secret .+ (for the .+ harness )?is not set|no credentials|api key.*(missing|not set)/i, "integration_not_configured"],
  [/(401|unauthorized|authentication failed|invalid api key|not logged in)/i, "authentication_required"],
  [/git clone .+ failed|setup command failed|restoring snapshot failed|no sandbox provider|docker .+ failed|image pull/i, "environment_setup_failed"],
  [/rate limit|429|overloaded|temporarily unavailable|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i, "resource_unavailable"],
  [/timed? ?out|deadline exceeded/i, "infrastructure_timeout"],
  [/content policy|safety system|refus/i, "content_policy_violation"],
  [/ENOENT.*(claude|codex|opencode|gemini|pi)\b|spawn .+ ENOENT|exited with code|process (crashed|exited)/i, "agent_process_failed"],
  [/blocked by guardrail|a human declined/i, "not_authorized"],
  [/push refused|git push failed/i, "conflict"],
  [/^unknown |not found|has no /i, "resource_not_found"],
];

/** Classify any thrown error into a catalog entry for the run record. */
export function classifyError(err: unknown): RunError {
  if (err instanceof KilnError) return { code: err.code, message: err.message, retryable: err.spec.retryable !== false, ...(Object.keys(err.details).length ? { details: err.details } : {}) };
  const message = err instanceof Error ? err.message : String(err);
  const hit = PATTERNS.find(([re]) => re.test(message));
  const code = hit?.[1] ?? "internal_error";
  return { code, message, retryable: ERROR_CATALOG[code]!.retryable !== false };
}

/** Kiln retries these by itself before reporting the run. */
export function retriesAutomatically(error: RunError | undefined): boolean {
  return Boolean(error && ERROR_CATALOG[error.code]?.retryable === "automatic");
}

export function runStatusFor(error: RunError): "failed" | "error" {
  return ERROR_CATALOG[error.code]?.state === "ERROR" ? "error" : "failed";
}

export function errorCatalog() {
  return Object.entries(ERROR_CATALOG).map(([code, s]) => ({ code, http: s.http, retryable: s.retryable, taskState: s.state, title: s.title }));
}
