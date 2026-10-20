import type { Factory } from "@kiln/schema";

/**
 * Cloud identity federation from factory.yaml `cloudProviders` (or its legacy alias `providers`),
 * as environment variables for runs. The run exchanges its own OIDC token for credentials; Kiln
 * never holds long-lived cloud keys.
 */
export function cloudProviderEnv(factory: Pick<Factory, "cloudProviders" | "providers">): Record<string, string> {
  const cp = factory.cloudProviders ?? factory.providers;
  const env: Record<string, string> = {};
  if (cp?.aws) {
    env.AWS_ROLE_ARN = cp.aws.roleArn;
    env.AWS_ROLE_SESSION_NAME = "kiln-run";
  }
  if (cp?.gcp) {
    const g = cp.gcp;
    env.GCP_PROJECT_NUMBER = g.projectNumber;
    env.GCP_WORKLOAD_IDENTITY_POOL_ID = g.workloadIdentityFederationPoolId;
    env.GCP_WORKLOAD_IDENTITY_PROVIDER_ID = g.workloadIdentityFederationProviderId;
    env.GCP_WORKLOAD_IDENTITY_PROVIDER = `projects/${g.projectNumber}/locations/global/workloadIdentityPools/${g.workloadIdentityFederationPoolId}/providers/${g.workloadIdentityFederationProviderId}`;
    if (g.serviceAccountEmail) env.GCP_SERVICE_ACCOUNT_EMAIL = g.serviceAccountEmail;
  }
  return env;
}
