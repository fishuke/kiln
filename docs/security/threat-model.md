# Kiln threat model

Kiln runs coding agents on untrusted input (issues, Slack threads, PR comments, web pages) with access to source code. This model lists what we protect, who attacks it, and the control for each threat. Tests are named where they exist.

## Assets
- Source repositories and their default branches.
- Secrets: forge tokens, model keys (including Claude subscription tokens), webhook secrets, API tokens.
- Factory definitions, policies and gates (the rules that review agents).
- Production systems reachable from sandboxes.

## Actors
- Outside reporters who can open issues or post in shared channels.
- Insiders without approval rights.
- A compromised or misled agent (prompt injection).
- The self-improvement loop itself.

## Threats and controls

| Threat | Control | Evidence |
| --- | --- | --- |
| Issue text tells the agent to merge, approve or push to main | Permissions come from policy, never content: run tokens cannot approve or merge and can push only `kiln/*`; branch protection rejects the rest | `e2e/security.test.ts`, `e2e/runtime.test.ts` (M2-T5), fake forge pre-receive hook |
| Someone types "approve" in a thread | Chat and tracker replies decide a gate only when the author maps to one of its assignees (`identities`) | `e2e/security.test.ts` |
| Agent runs destructive or remote commands | Command guard on every Claude Code tool call and every Kiln-run shell command; risky commands become inbox questions; destructive ones are blocked; failure of both providers blocks | `packages/decide`, `e2e/runtime.test.ts` (M2-T7) |
| Agent exfiltrates secrets | Agents get only declared secrets; server env readable only for provider keys and `KILN_SECRET_*`; sandboxes have no network unless the runner allows hosts, via an egress proxy | `e2e/runtime.test.ts` (secrets), `dockerRunArgs`, Kubernetes NetworkPolicy |
| Sandbox escape | Docker: `--cap-drop ALL`, `no-new-privileges`; Kubernetes: gVisor runtime class, non-root, no service account token | `packages/sandbox` tests |
| Self-improvement weakens its own checks | Changes to `policies/`, `gates/` and protected paths are dropped; two-approval paths need two people; proposals without a replay report are refused | `e2e/factory.test.ts` (M5-T2) |
| Forged webhooks | Signatures verified (GitHub, Slack, Linear, Stripe, Sentry, Standard Webhooks); deliveries deduplicated | `apps/api/src/app.test.ts`, `e2e/fixes.test.ts` |
| Over-broad API or MCP tokens | Per-factory scopes; MCP calls go through the API with the caller's token | `apps/api/src/app.test.ts` (M7-T1) |
| Runaway spend | Per-work-item, policy and monthly budgets stop new runs | `e2e/runtime.test.ts`, `e2e/fixes.test.ts` |
| Tampering without trace | Every definition change, decision, token, secret write and steering message is in the audit log | `/api/v1/audit` |

## Known gaps
- Codex and OpenCode tool calls are not individually guarded (see ADR-004).
- A ChatGPT login is a whole ChatGPT session, not an inference-only key: the agent in a Codex run can read its `auth.json` and, with `chatgpt.com` allowed, reach that account's ChatGPT data. Kiln keeps a refreshed `auth.json` only when it is the same account with a newer refresh, but cannot stop an agent from copying the tokens out. Egress allowlists are global, so allowing `chatgpt.com` and `auth.openai.com` for ChatGPT logins allows them for every sandbox. Use dedicated ChatGPT accounts for team logins.
- The local sandbox provider runs on the host and cannot enforce egress or limits; use Docker or Kubernetes in production.
- OIDC sign-in is not built; the web app uses a server-side token. Put it behind your SSO proxy.
- Secrets are stored in the data directory unencrypted; mount it on an encrypted volume or use a secrets manager.
