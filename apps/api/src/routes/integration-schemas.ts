import { FactoryIntegration, SignatureScheme, WebhookAuthMode } from "@kiln/schema";
import { z } from "zod";

/** Request bodies for the connections, automations and custom-webhook routes. */
export const ConnectionComplete = z.object({ code: z.string().optional(), state: z.string().optional(), params: z.record(z.string(), z.string()).optional() }).strict();
export const ApprovalLinkCreate = z.object({ email: z.string().email().optional() }).strict();
export const Directory = z.record(z.string(), z.record(z.string(), z.string()));
export const IdentityClaim = z.object({ token: z.string().min(1) }).strict();
export const FactoryIntegrationsBody = z.object({ integrations: z.array(FactoryIntegration) }).strict();
export const TeamsPackageQuery = z.object({ name: z.string().optional(), developer: z.string().optional(), website: z.string().url().optional(), color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional() });
export const DiscordCommandsBody = z.object({ guildId: z.string().optional() }).strict();

export const TestFilter = z.object({ deliveryId: z.string().min(1) }).strict();
export const FromTemplate = z.object({ template: z.string().min(1), name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional() }).strict();

export const WebhookCreate = z
  .object({
    name: z.string().min(1),
    authMode: WebhookAuthMode.optional(),
    signatureScheme: SignatureScheme.optional(),
    /** The provider's signing secret (signature mode). Omit to "create and get URL" and finish later. */
    secret: z.string().min(1).optional(),
    deliveryIdHeader: z.string().optional(),
  })
  .strict();
export const WebhookPatch = z.object({ enabled: z.boolean().optional(), deliveryIdHeader: z.string().nullable().optional() }).strict();
export const WebhookSecret = z.object({ secret: z.string().min(1) }).strict();
export const WebhookRotate = z.object({ secret: z.string().min(1).optional() }).strict();
