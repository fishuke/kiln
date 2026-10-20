import type { Kiln } from "../kiln";
import { newId } from "../types";
import { P, PlatformError, type EnvironmentTemplate } from "./types";

export type EnvironmentInput = Pick<EnvironmentTemplate, "name"> & Partial<Pick<EnvironmentTemplate, "description" | "image" | "repos" | "setupCommands" | "secrets">>;

/** Team-wide environment templates: an image, repos, setup commands and secrets that runs start from. */
export class EnvironmentService {
  constructor(private readonly k: Kiln) {}

  list(teamId: string): EnvironmentTemplate[] {
    return this.k.store.list<EnvironmentTemplate>(P.environments, (e) => e.teamId === teamId).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** By id, or by name within the team. */
  get(teamId: string | undefined, idOrName: string): EnvironmentTemplate | undefined {
    const e = this.k.store.get<EnvironmentTemplate>(P.environments, idOrName);
    if (e && (!teamId || e.teamId === teamId)) return e;
    return teamId ? this.list(teamId).find((x) => x.name === idOrName) : undefined;
  }

  create(teamId: string, input: EnvironmentInput, by: string): EnvironmentTemplate {
    if (this.list(teamId).some((e) => e.name === input.name)) throw new PlatformError(409, `an environment named ${input.name} exists`);
    const now = this.k.clock.now().toISOString();
    const env: EnvironmentTemplate = {
      id: newId("env"),
      teamId,
      name: input.name,
      description: input.description,
      image: input.image,
      repos: input.repos ?? [],
      setupCommands: input.setupCommands ?? [],
      secrets: input.secrets ?? [],
      createdBy: by,
      createdAt: now,
      updatedAt: now,
    };
    this.k.store.put(P.environments, env);
    this.k.audit(by, "environment.created", env.id, { name: env.name, team: teamId });
    return env;
  }

  update(teamId: string, id: string, patch: Partial<EnvironmentInput>, by: string): EnvironmentTemplate {
    const e = this.get(teamId, id);
    if (!e) throw new PlatformError(404, `unknown environment ${id}`);
    if (patch.name && patch.name !== e.name && this.list(teamId).some((x) => x.name === patch.name)) throw new PlatformError(409, `an environment named ${patch.name} exists`);
    const next = { ...e, ...patch, updatedAt: this.k.clock.now().toISOString() };
    this.k.store.put(P.environments, next);
    this.k.audit(by, "environment.updated", e.id, { fields: Object.keys(patch) });
    return next;
  }

  delete(teamId: string, id: string, by: string) {
    const e = this.get(teamId, id);
    if (!e) throw new PlatformError(404, `unknown environment ${id}`);
    this.k.store.delete(P.environments, e.id);
    this.k.audit(by, "environment.deleted", e.id, { name: e.name });
  }
}
