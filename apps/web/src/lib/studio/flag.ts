/** NEXT_PUBLIC_KILN_STUDIO_FAKE=1 runs /studio on the in-memory FakeStudioClient (development only). */
export function studioFakeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_KILN_STUDIO_FAKE === "1";
}
