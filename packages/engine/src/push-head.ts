import type { ExecResult } from "@kiln/sandbox";

type Sh = (cmd: string) => Promise<ExecResult>;

/**
 * The commit Kiln pushes to a work item branch: HEAD, unless the agent rewrote history the branch already has
 * (a rebase, an amend, a dropped commit). Kiln never force-pushes. When the branch has not moved since the run
 * started, the agent's final tree is kept as one commit on top of the branch, so the push is a fast-forward.
 * When someone else pushed to the branch during the run, it throws instead of overwriting their work.
 */
export async function pushableHead(sh: Sh, opts: { branch: string; head: string; start?: string; remote?: string; label: string }): Promise<string> {
  const { branch, head, start, remote, label } = opts;
  if (!remote || remote === head) return head;
  if ((await sh(`git merge-base --is-ancestor ${remote} ${head}`)).code === 0) return head;
  if (remote !== start)
    throw new Error(`git push failed: ${branch} moved to ${remote.slice(0, 7)} since the run started at ${start?.slice(0, 7) ?? "?"}; Kiln does not overwrite it`);
  const messages = (await sh(`git log --format=%B ${remote}..${head}`)).stdout.trim();
  const message = [
    label,
    `The agent rewrote history that ${branch} already had; Kiln keeps its result as one commit on top of ${remote.slice(0, 7)} instead of force-pushing.`,
    ...(messages ? [messages] : []),
  ].join("\n\n");
  const res = await sh(`git commit-tree ${head}^{tree} -p ${remote} -m ${JSON.stringify(message)}`);
  const commit = res.stdout.trim();
  if (res.code !== 0 || !commit) throw new Error(`git push failed: could not put the agent's result on top of ${branch}: ${res.stderr}`);
  await sh(`git reset -q --soft ${commit}`);
  return commit;
}
