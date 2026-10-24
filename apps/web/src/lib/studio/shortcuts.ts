/**
 * Whether an Alt key press in a text field types a character rather than a shortcut: on Mac layouts ⌥
 * types characters ([ ] { } ~ on German layouts) and dead keys (ñ). Elsewhere Alt shortcuts stay.
 * ⌥ characters outside ASCII (π, ∂) are no one's text, so ⌥P and the like still switch.
 */
export function altTypes(e: { key: string; code: string; target: EventTarget | { tagName?: string; isContentEditable?: boolean } | null }): boolean {
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true);
  if (!typing) return false;
  if (e.key === "Dead") return true;
  // The key's own character (Digit8 → "8", KeyN → "n"); Alt that types another ASCII character is text.
  const plain = /^(?:Key|Digit)(.)$/.exec(e.code)?.[1]?.toLowerCase();
  return e.key.length === 1 && /[\x20-\x7e]/.test(e.key) && e.key.toLowerCase() !== plain;
}
