import { describe, expect, it } from "vitest";
import { FakeStudioClient, titleFrom } from "./fake";
import { unappliedTurns } from "./model";
import { ChatDetail, ProjectDetail } from "./types";

/** A fake whose timers run when the test says so. */
function setup() {
  let t = Date.parse("2026-10-22T10:00:00.000Z");
  const queue: { at: number; fn: () => void }[] = [];
  const studio = new FakeStudioClient({
    now: () => new Date(t),
    schedule: (fn, ms) => void queue.push({ at: t + ms, fn }),
    stepMs: 100,
  });
  const run = () => {
    while (queue.length) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue.shift()!;
      t = Math.max(t, next.at);
      next.fn();
    }
  };
  return { studio, run };
}

async function readyProject(studio: FakeStudioClient, run: () => void, shipMode?: "safe" | "cowboy") {
  const p = await studio.createProject({ name: "Shop", shipMode });
  run();
  return p.id;
}

describe("FakeStudioClient", () => {
  it("creates a project that becomes ready with an initial version", async () => {
    const { studio, run } = setup();
    const p = await studio.createProject({ name: "Shop" });
    expect(p.status).toBe("creating");
    expect(p.shipMode).toBe("cowboy");
    run();
    const detail = ProjectDetail.parse(await studio.project(p.id));
    expect(detail.project.status).toBe("ready");
    expect(detail.versions.map((v) => v.kind)).toEqual(["initial"]);
  });

  it("checkpoints a build turn and applies it in cowboy mode", async () => {
    const { studio, run } = setup();
    const id = await readyProject(studio, run);
    const { chat, turn } = await studio.newChat(id, { prompt: "Add a pricing page" });
    expect(turn?.status).toBe("running");
    run();
    const detail = ChatDetail.parse(await studio.chat(chat.id));
    expect(detail.turns[0]!.checkpoint).toBeTruthy();
    expect(detail.turns[0]!.activity.length).toBeGreaterThan(2);
    const { versions } = await studio.project(id);
    expect(versions[0]!.title).toBe("Add a pricing page");
  });

  it("makes no checkpoint for a question", async () => {
    const { studio, run } = setup();
    const id = await readyProject(studio, run);
    const { chat } = await studio.newChat(id, { prompt: "Does it work on mobile?" });
    run();
    const { turns } = await studio.chat(chat.id);
    expect(turns[0]!.checkpoint).toBeUndefined();
    expect((await studio.project(id)).versions).toHaveLength(1);
  });

  it("waits for Apply in safe mode", async () => {
    const { studio, run } = setup();
    const id = await readyProject(studio, run, "safe");
    const { chat } = await studio.newChat(id, { prompt: "Add a footer" });
    run();
    let detail = await studio.chat(chat.id);
    expect(unappliedTurns(detail.chat, detail.turns)).toHaveLength(1);
    const res = await studio.apply(chat.id);
    expect(res.ok).toBe(true);
    detail = await studio.chat(chat.id);
    expect(unappliedTurns(detail.chat, detail.turns)).toHaveLength(0);
    expect(await studio.apply(chat.id)).toEqual({ ok: false, nothing: true });
  });

  it("steers a running turn instead of starting another", async () => {
    const { studio, run } = setup();
    const id = await readyProject(studio, run);
    const { chat } = await studio.newChat(id, { prompt: "Add a footer" });
    const steer = await studio.send(chat.id, { text: "make it dark" });
    expect(steer.steered).toBe(true);
    run();
    expect((await studio.chat(chat.id)).turns).toHaveLength(1);
  });

  it("returns a plan in plan mode and asks in needs_you", async () => {
    const { studio, run } = setup();
    const id = await readyProject(studio, run);
    const { chat } = await studio.newChat(id, { prompt: "Plan a blog", mode: "plan" });
    run();
    expect((await studio.chat(chat.id)).turns[0]!.plan).toMatch(/1\./);
    await studio.send(chat.id, { text: "Add a theme, ask me which default", mode: "build" });
    run();
    const after = await studio.chat(chat.id);
    expect(after.chat.status).toBe("needs_you");
    expect((await studio.status()).projects[0]!.needsYou).toHaveLength(1);
  });

  it("restores as a new version and bookmarks", async () => {
    const { studio, run } = setup();
    const id = await readyProject(studio, run);
    const [initial] = (await studio.project(id)).versions;
    const restored = await studio.restore(initial!.id);
    expect(restored.kind).toBe("restore");
    expect((await studio.bookmark(initial!.id, true)).bookmarked).toBe(true);
    expect((await studio.project(id)).versions).toHaveLength(2);
  });

  it("imports a repository step by step and asks for missing env", async () => {
    const { studio, run } = setup();
    const p = await studio.createProject({ name: "Store", source: { kind: "repo", repo: "acme/storefront", branch: "main" } });
    expect(p.setup?.steps[0]).toEqual({ id: "clone", status: "running" });
    run();
    const { project } = await studio.project(p.id);
    expect(project.setup?.steps.every((s) => s.status === "done")).toBe(true);
    expect(project.setup?.missingEnv).toEqual(["DATABASE_URL", "NEXTAUTH_SECRET"]);
    const updated = await studio.updateProject(p.id, { env: { DATABASE_URL: "postgres://x" }, devCommand: "npm run dev" });
    expect(updated.setup?.missingEnv).toEqual(["NEXTAUTH_SECRET"]);
    expect(updated.setup?.devCommand).toBe("npm run dev");
  });

  it("titles from the first clause", () => {
    expect(titleFrom("please add a dark mode toggle. Thanks")).toBe("Add a dark mode toggle");
  });
});
