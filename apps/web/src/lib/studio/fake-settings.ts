import type { StudioAppSettings } from "@kiln/sdk-ts";

/** Resolved App settings for the development fake (NEXT_PUBLIC_KILN_STUDIO_FAKE=1), which has no API. */
export function fakeAppSettings(): StudioAppSettings {
  const at = new Date(Date.now() - 2 * 86_400_000).toISOString();
  return {
    sha: "4f1c2ab9d0e3",
    layer: { kind: "app", sha: "4f1c2ab9d0e3", history: [{ sha: "4f1c2ab9d0e3", at, by: "you@example.com", message: "Model for the lead agent" }] },
    resolved: {
      agents: [
        {
          name: "lead",
          description: "Builds the App from the chat",
          harness: "claude-code",
          model: "claude-opus-5-5",
          instructions: "Keep the existing components; write tests for new behaviour.",
          mcpServers: [],
          skills: ["nextjs"],
          spawnableBy: [],
          from: "app",
        },
      ],
      skills: [{ name: "nextjs", description: "App Router conventions", body: "", mandatory: true, from: "team" }],
      policy: { maxShipMode: "cowboy", roles: {}, pushDefaultBranch: false, mergeGate: false, changedBy: {} },
      monthlyUsd: 50,
    },
    own: { agents: { lead: { model: "claude-opus-5-5" } }, skills: [], mandatory: [], policy: { roles: {} } },
    warnings: [],
  } as StudioAppSettings;
}
