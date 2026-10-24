/**
 * Whether a key event's target takes typed text. Alt shortcuts skip these: on Mac layouts ⌥ types
 * characters ([ ] { } ~) and dead keys (ñ).
 */
export function isTypingTarget(target: EventTarget | { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!target || !("tagName" in target)) return false;
  const t = target as { tagName?: string; isContentEditable?: boolean };
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true;
}
