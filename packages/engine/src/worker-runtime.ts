import type { HarnessAdapter, HarnessSession } from "@kiln/harness";
import { hashDir, type GuardVerdict, type Sandbox, type SandboxProvider } from "@kiln/sandbox";
import type { HarnessType } from "@kiln/schema";
import { mediaOf } from "./media";
import type { WorkerEvent, WorkerJob, WorkerResult } from "./workers";

export type JobHandle = { steer(text: string): Promise<void>; stop(): Promise<void>; result: Promise<WorkerResult> };

export type JobDeps = {
  provider: SandboxProvider;
  harness: (type: HarnessType, agentType: string) => HarnessAdapter;
  emit: (e: WorkerEvent) => void;
  /** Ask the Kiln API about an agent's shell command; omit to allow every command. */
  guard?: (command: string, cwd?: string) => Promise<GuardVerdict>;
  /** Extra environment variables from the worker's own configuration (`--env`). */
  env?: Record<string, string>;
  /** Keep the sandbox after the run (`--no-cleanup`). */
  keepSandbox?: boolean;
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/**
 * Run one job on this machine: prepare the sandbox, run the harness, collect the result and
 * artifacts, push the branch with the run's scoped token. Used by `kiln worker`; the server
 * never calls it.
 */
export function startWorkerJob(job: WorkerJob, deps: JobDeps): JobHandle {
  let session: HarnessSession | undefined;
  const pendingSteer: string[] = [];
  let stopped = false;

  const result = (async (): Promise<WorkerResult> => {
    const base: WorkerResult = { outcome: "failed", summary: "", costUsd: 0, artifacts: [], pushed: [], startRepos: [] };
    let sandbox: Sandbox | undefined;
    try {
      sandbox = await deps.provider.create({
        runner: job.runner,
        repos: job.repos.map((r) => ({ name: r.name, url: r.url })),
        env: { KILN_RUN_ID: job.runId, ...deps.env },
        labels: { "kiln.dev/run": job.runId, "kiln.dev/factory": job.factory },
        deniedHosts: job.deniedHosts,
        guard: deps.guard ? (command) => deps.guard!(command, sandbox?.workdir) : undefined,
      });
      const sb = sandbox;
      deps.emit({ type: "started", text: `${sb.provider} sandbox ${sb.id}` });
      const cwd = job.repos[0]?.name;
      for (const r of job.repos) {
        const sh = (cmd: string) => sb.exec(cmd, { cwd: r.name, trusted: true });
        await sh(`git config user.name "kiln-agent[bot]" && git config user.email "agent@kiln.local" && mkdir -p .git/info && echo ".kiln/" >> .git/info/exclude`);
        const pin = job.pinned?.[r.name];
        if (pin) await sh(`git checkout -q -B ${job.branch ?? "kiln/replay"} ${pin}`);
        else if (job.branch) await sh(`git fetch -q origin ${job.branch} 2>/dev/null && git checkout -q -B ${job.branch} FETCH_HEAD || git checkout -q -B ${job.branch}`);
        base.startRepos.push({ name: r.name, key: r.key, branch: job.branch, sha: (await sh("git rev-parse HEAD")).stdout.trim() });
      }
      for (const [path, content] of Object.entries(job.files)) await sb.writeFile(path, content);
      for (const a of job.attachments) await sb.writeBytes(`${cwd ? `${cwd}/` : ""}.kiln/attachments/${a.name}`, Buffer.from(a.base64, "base64"));
      if (sb.provider === "local") base.workspaceSha = hashDir(sb.workdir);
      if (stopped) return { ...base, outcome: "cancelled", summary: "cancelled before the agent started" };

      session = await deps.harness(job.harness, job.agentType).start({
        sandbox: sb,
        cwd,
        instructions: job.instructions,
        prompt: job.prompt,
        model: job.model,
        skills: job.skills,
        mcpServers: job.mcpServers,
        guardUrl: job.guardUrl,
        env: { ...job.env, ...deps.env },
      });
      for (const text of pendingSteer.splice(0)) await session.steer(text);
      if (stopped) await session.stop();
      for await (const e of session.events) {
        if (e.type === "message" || e.type === "steer" || e.type === "error") deps.emit({ type: e.type, text: e.text });
        else if (e.type === "reasoning") deps.emit({ type: "reasoning", text: e.text, ...(e.durationMs !== undefined ? { data: { durationMs: e.durationMs } } : {}) });
        else if (e.type === "tool_call") deps.emit({ type: "tool_call", text: e.name, data: e.input });
        else if (e.type === "tool_result") deps.emit({ type: "tool_result", text: e.output?.slice(0, 4000), data: { isError: e.isError } });
      }
      const r = await session.result;
      base.outcome = stopped ? "cancelled" : r.outcome;
      base.summary = r.summary;
      base.costUsd = r.costUsd;
      const raw = await sb.readFile(`${cwd ? `${cwd}/` : ""}.kiln/result.json`);
      if (raw) {
        try {
          base.result = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          deps.emit({ type: "error", text: "could not parse .kiln/result.json" });
        }
      }
      const prefix = cwd ? `${cwd}/` : "";
      const listed = (await sb.exec(`[ -d ${prefix}.kiln/artifacts ] && cd ${prefix}.kiln/artifacts && find . -type f -size -20M | sed 's|^./||' || true`, { trusted: true })).stdout.split("\n").filter(Boolean);
      for (const rel of listed.slice(0, 50)) {
        const bytes = await sb.readBytes(`${prefix}.kiln/artifacts/${rel}`);
        if (!bytes) continue;
        const name = rel.split("/").pop()!;
        base.artifacts.push({ name, contentType: mediaOf(name).contentType, base64: b64(bytes) });
        deps.emit({ type: "artifact", text: name });
      }
      if (base.outcome === "succeeded" && job.push && job.branch) {
        let additions = 0;
        let deletions = 0;
        let files = 0;
        for (const repo of job.repos) {
          const sh = (cmd: string, env?: Record<string, string>) => sb.exec(cmd, { cwd: repo.name, trusted: true, env });
          if ((await sh("git status --porcelain")).stdout.trim()) await sh(`git add -A && git commit -q -m ${JSON.stringify(`kiln: ${job.agent} (${job.runId})`)}`);
          const head = (await sh("git rev-parse HEAD")).stdout.trim();
          const start = base.startRepos.find((x) => x.name === repo.name)?.sha;
          const remote = (await sh(`git ls-remote origin refs/heads/${job.branch}`)).stdout.split(/\s/)[0];
          if (start && start !== head) {
            for (const line of (await sh(`git diff --numstat ${start} ${head}`)).stdout.split("\n").filter(Boolean)) {
              const [a, d] = line.split("\t");
              additions += Number(a) || 0;
              deletions += Number(d) || 0;
              files += 1;
            }
          }
          if ((head === start && !remote) || remote === head) continue;
          const res = await sh(`git push -q origin HEAD:refs/heads/${job.branch}`, { KILN_PUSH_AS: `agent:${job.runId}` });
          if (res.code !== 0) throw new Error(`git push failed: ${res.stderr}`);
          base.pushed.push({ repo: repo.key, branch: job.branch, sha: head });
          deps.emit({ type: "pushed", text: `${repo.key} ${job.branch} @ ${head.slice(0, 7)}` });
        }
        base.diffStat = { additions, deletions, files };
      }
      return base;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.emit({ type: "error", text: message });
      return { ...base, outcome: "failed", summary: message, error: message };
    } finally {
      if (sandbox && !deps.keepSandbox) await sandbox.destroy().catch(() => {});
    }
  })();

  return {
    result,
    steer: async (text) => {
      if (session) await session.steer(text);
      else pendingSteer.push(text);
    },
    stop: async () => {
      stopped = true;
      await session?.stop();
    },
  };
}
