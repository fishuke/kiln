/** NEXT_PUBLIC_KILN_STUDIO_FAKE=1 runs /studio on the in-memory FakeStudioClient (development only). */
export function studioFakeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_KILN_STUDIO_FAKE === "1";
}

/**
 * KILN_STUDIO_CONTEXT=1 makes the Context page (docs/specs/studio-context.md) the Studio page of an
 * App. Read on the server and passed down: without it the current page is what everyone gets.
 */
export function studioContextEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.KILN_STUDIO_CONTEXT === "1";
}
