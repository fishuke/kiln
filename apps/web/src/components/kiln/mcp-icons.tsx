/** Brand marks used only by the MCP templates. */
export function FigmaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 24" className={className} aria-hidden>
      <path d="M4 24a4 4 0 0 0 4-4v-4H4a4 4 0 0 0 0 8" fill="#0ACF83" />
      <path d="M0 12a4 4 0 0 1 4-4h4v8H4a4 4 0 0 1-4-4" fill="#A259FF" />
      <path d="M0 4a4 4 0 0 1 4-4h4v8H4a4 4 0 0 1-4-4" fill="#F24E1E" />
      <path d="M8 0h4a4 4 0 0 1 0 8H8z" fill="#FF7262" />
      <path d="M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0" fill="#1ABCFE" />
    </svg>
  );
}
