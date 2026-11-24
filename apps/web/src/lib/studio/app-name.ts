/**
 * A short App name from the prompt it is created with, so a prompt alone is enough to create one:
 * "make a todo app" → "Todo app", "I want a recipe box I can search" → "Recipe box I can search".
 */
export function nameFromPrompt(prompt: string): string {
  const first = prompt.trim().split(/[\n.!?,:;]/)[0] ?? "";
  const words = first
    .replace(/^(please\s+)?((can|could|would)\s+you\s+)?((i\s+(want|need|would\s+like))|(let'?s)|make|build|create|write|design|give\s+me|help\s+me\s+(make|build))\s+(me\s+)?/i, "")
    .replace(/^(a|an|the|my|some)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  const name = words.join(" ").replace(/[^\p{L}\p{N}' &-]+$/u, "");
  return name ? name[0]!.toUpperCase() + name.slice(1) : "";
}
