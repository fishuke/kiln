import "server-only";
import { api } from "@/lib/kiln";

/**
 * Workspace connections. Raw fetchers until the SDK in this branch has them; they go through
 * the per-request client, so they act as the signed-in user.
 */

export type ConnectionStatus = "connected" | "pending_approval" | "error";

export type Connection = {
  provider: string;
  status: ConnectionStatus;
  account?: { id: string; name: string; url?: string };
  installation?: Record<string, string | number | boolean | undefined>;
  scopes?: string[];
  connectedBy?: string;
  connectedAt?: string;
  error?: string;
  lastTest?: { ok: boolean; message: string; at: string };
  secretNames?: string[];
};

export type ConnectionRow = { provider: string; label: string; mode?: string; available: boolean; connection?: Connection; pendingApprovals: number };

export type StartResult = { provider: string; state: string; url?: string; instructions?: string; steps?: string[]; fields?: { name: string; label: string; secret?: boolean; optional?: boolean }[] };

export const connections = () => api.request<ConnectionRow[]>("GET", "/api/v1/connections");
export const startConnection = (provider: string) => api.request<StartResult>("POST", `/api/v1/connections/${encodeURIComponent(provider)}/start`);
export const completeConnection = (provider: string, input: { code?: string; state?: string; params?: Record<string, string> }) => api.request<Connection>("POST", `/api/v1/connections/${encodeURIComponent(provider)}/complete`, input);
export const testConnection = (provider: string) => api.request<{ ok: boolean; message: string }>("POST", `/api/v1/connections/${encodeURIComponent(provider)}/test`);
export const disconnect = (provider: string) => api.request<{ ok: true }>("DELETE", `/api/v1/connections/${encodeURIComponent(provider)}`);
