import { describe, expect, it } from "vitest";
import type { DefinitionTree } from "./tree";
import { formatErrors, validateTree } from "./validate";

/** Every key the web editors write, in the shapes they write them. */
const tree: DefinitionTree = {
  "factory.yaml": `schemaVersion: kiln/v1
name: web-app
alias: webapp
description: The storefront
avatar: uploads/team/avatar.png
credentialStrategy: CREATOR
repositories:
  - { owner: acme, name: web-app }
  - { forge: gitlab, owner: acme, name: api, deferred: true }
agentDefaults:
  harness: { type: claude-code, model: claude-fable-5-1, auth: { source: secret, secretName: CLAUDE_TOKEN } }
  workerHost: farm
  runner: linux-node
  secrets: [NPM_TOKEN]
  mcpServers: [sentry]
scorerDefaults: { runner: linux-node, secrets: [NPM_TOKEN], mcpServers: [sentry] }
scoring: { defaultModel: claude-fable-5-1 }
selfImprovement:
  model: claude-fable-5-1
  failedRunThreshold: 5
  reviewers: { type: custom, emails: [lead@acme.test] }
  scorers: [criteria]
cloudProviders:
  aws: { roleArn: "arn:aws:iam::123456789012:role/kiln" }
  gcp: { projectNumber: "123", workloadIdentityFederationPoolId: pool, workloadIdentityFederationProviderId: prov, serviceAccountEmail: kiln@acme.iam.gserviceaccount.com }
`,
  "agents/foreman/agent.md": "---\nagentType: FOREMAN\n---\nRoute work.\n",
  "agents/implement/agent.md": "---\nagentType: IMPLEMENT\nworkerHost: farm\ncomputerUse: false\nrunner: mac\nidleTimeoutMinutes: 30\n---\nBuild.\n",
  "runners/linux-node.yaml":
    "backend: docker\nimage: node:22-bookworm\nregistryCredentialSecretName: REGISTRY\nfailureSessionRetentionMinutes: 30\nshape: { vcpus: 4, memoryGb: 8 }\nsetupCommands: [pnpm install]\n",
  "runners/mac.yaml": "backend: docker\nimage: node:22-bookworm\nplatform: { os: macos }\n",
  "runners/private.yaml": "image: ghcr.io/acme/runner:1\nplatform: { linux: { registryCredentialSecretName: GHCR } }\n",
  "scorers/criteria/scorer.md":
    "---\nname: Criteria\nagents:\n  - implement\n  - { name: foreman, includeDescendants: true }\nmodel: claude-fable-5-1\nlabels: [{ value: pass, score: 1 }, { value: fail, score: 0 }]\npassingScore: 1\nrunner: linux-node\nsecrets: [NPM_TOKEN]\nmcpServers: [sentry]\n---\nDid it meet the criteria?\n",
  "benchmarks/smoke/suite.yaml":
    "name: Smoke\nagent: implement\nconfigurations:\n  - { name: fable, runner: linux-node, agents: [{ agent: implement, model: claude-fable-5-1 }] }\ntasks: [typo]\n",
  "benchmarks/smoke/tasks/typo.yaml": `title: Fix a typo\nprompt: Fix the typo in the README\nsuccessCriteria: [README has no typo]\nstartingRepoRefs: ["github.com:acme/web-app@${"a".repeat(40)}"]\n`,
};

describe("keys the editors write", () => {
  it("validate under the strict schema", () => {
    const r = validateTree(tree);
    expect(r.ok ? "" : formatErrors(r.errors)).toBe("");
  });
});
