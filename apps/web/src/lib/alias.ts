/**
 * Foreman name (factory.yaml `alias`): the handle people @-mention in Slack, Teams, Linear, Jira and
 * GitHub, and the suffix of the `factory:<alias>` label. 1–60 characters, lowercase letters, digits
 * and dashes, starting with a letter or digit; unique per workspace, ignoring case.
 */
export const ALIAS_MAX = 60;

export function toAlias(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ALIAS_MAX)
    .replace(/-+$/, "");
}

export function validateAlias(raw: string, taken: string[] = [], current?: string): string | null {
  const alias = raw.trim().replace(/^@/, "");
  if (!alias) return "Enter a foreman name.";
  if (alias.length > ALIAS_MAX) return `Use at most ${ALIAS_MAX} characters.`;
  if (/[A-Z]/.test(alias)) return "Use lowercase letters.";
  if (!/^[a-z0-9]/.test(alias)) return "Start with a letter or a digit.";
  if (!/^[a-z0-9-]+$/.test(alias)) return "Use only letters, digits and dashes.";
  const lower = alias.toLowerCase();
  if (taken.some((t) => t.toLowerCase() === lower && t.toLowerCase() !== current?.toLowerCase())) return `@${alias} is already used by another factory.`;
  return null;
}
