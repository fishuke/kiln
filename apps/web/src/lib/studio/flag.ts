/** KILN_STUDIO_FAKE=1 runs /studio on the in-memory FakeStudioClient, without the Studio API. */
export function studioFakeEnabled(): boolean {
  return process.env.KILN_STUDIO_FAKE === "1";
}
