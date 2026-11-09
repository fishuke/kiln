/**
 * Shell command that cuts a clone down to the checked-out branch, so a pinned benchmark trial
 * cannot read history after its pin: every other ref (branches, remote-tracking refs, tags) and
 * the `origin` remote go, then the reflog is expired and unreachable objects are pruned.
 */
export function isolatePinCommand(branch: string): string {
  const keep = `refs/heads/${branch}`;
  return [
    `git for-each-ref --format='%(refname)' | grep -vxF '${keep}' | while read -r ref; do git update-ref -d "$ref"; done`,
    "git remote remove origin 2>/dev/null || true",
    "rm -f .git/packed-refs.lock .git/FETCH_HEAD .git/ORIG_HEAD",
    "git reflog expire --expire=now --all",
    "git gc -q --prune=now",
  ].join(" && ");
}
