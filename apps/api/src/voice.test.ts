import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestKiln, FakeClock, type Kiln } from "@kiln/engine";
import { FakeHarness } from "@kiln/harness";
import { LocalSandboxProvider } from "@kiln/sandbox";
import { studioEngineHooks } from "@kiln/studio";
import {
  AnthropicThinker,
  FakeThinker,
  FakeVoiceProvider,
  VOICE_SESSIONS,
  VoiceSessionStore,
  type ConductorCall,
  type ThinkInput,
  type Thinker,
  type VoiceSession,
} from "@kiln/voice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { voiceThinker } from "./config";
import { ROUTES } from "./openapi";
import { configureStudio, studioFor } from "./routes/studio";
import { configureVoice, routes as voiceRoutes, voiceFor } from "./routes/voice";

const kilns: object[] = [];

function setup(script: ConductorCall[][] = [], thinker: Thinker & { inputs?: ThinkInput[] } = new FakeThinker(script)) {
  const agent = new FakeHarness(async ({ emit }) => emit({ type: "message", text: "Done." }));
  const clock = new FakeClock();
  const t: ReturnType<typeof createTestKiln> = createTestKiln({
    clock,
    preview: false,
    harness: () => agent,
    sandboxes: { local: new LocalSandboxProvider(mkdtempSync(join(tmpdir(), "kiln-api-voice-"))) },
    ...studioEngineHooks(() => studioFor(t.kiln)),
  });
  configureStudio(t.kiln, {
    templates: { test: { id: "test", name: "Test", scaffold: ["echo hi > README.md"], install: [], dev: "sleep 30", egress: [] } },
    basePort: 30_000 + Math.floor(Math.random() * 20_000),
  });
  const provider = new FakeVoiceProvider();
  const anthropicKeys: (string | undefined)[] = [];
  configureVoice(t.kiln, {
    provider,
    thinker: (key) => {
      anthropicKeys.push(key);
      return thinker;
    },
  });
  kilns.push(t.kiln);
  const app = createApp(t.kiln, { devAuth: true });
  const team = t.kiln.teams.ensureDefaultTeam().id;
  return { ...t, clock, app, provider, thinker: thinker as FakeThinker, anthropicKeys, team };
}

beforeEach(() => {
  vi.stubEnv("KILN_STUDIO", "1");
  vi.stubEnv("OPENAI_API_KEY", "");
});

afterEach(async () => {
  for (const k of kilns.splice(0)) {
    voiceFor(k as never)?.shutdown();
    await studioFor(k as never)?.shutdown();
  }
  vi.unstubAllEnvs();
});

const json = (method: string, body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const session = (kiln: Kiln, id: string) => kiln.store.get<VoiceSession>(VOICE_SESSIONS, id)!;

/** Reads a server-sent event stream until `until` holds for what arrived so far. */
function reader(res: Response) {
  const r = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return {
    async until(check: (t: string) => boolean) {
      while (!check(text)) text += decoder.decode((await r.read()).value);
      return text;
    },
    cancel: () => r.cancel(),
  };
}

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("Voice API", () => {
  it("creates a GPT-Live session with the team's OpenAI key and returns the answer", async () => {
    const { app, kiln, provider, team } = setup();
    kiln.vault.setModelKey(team, "openai", "sk-team-openai", "test");
    const res = await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer", app: "sa_1", chat: "sc_1" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; sdp: string };
    expect(body).toEqual({ id: expect.stringMatching(/^vs_/), sdp: "answer:offer" });
    expect(provider.created).toEqual([{ apiKey: "sk-team-openai", sdp: "offer", instructions: expect.stringContaining("sc_1") }]);
    expect(provider.attached).toEqual([{ sessionId: "live_1", apiKey: "sk-team-openai" }]);
    expect(session(kiln, body.id)).toMatchObject({
      team,
      by: "dev@kiln.local",
      liveSessionId: "live_1",
      status: "connecting",
      focus: { app: "sa_1", chat: "sc_1" },
    });
  });

  it("falls back to the server's OPENAI_API_KEY, and answers 409 no_openai_key without either", async () => {
    const { app, provider } = setup();
    const missing = await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }));
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ code: "no_openai_key" });
    expect(provider.created).toEqual([]);

    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    expect((await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).status).toBe(201);
    expect(provider.created[0]!.apiKey).toBe("sk-server-openai");
  });

  it("relays the person's words verbatim to the focused chat on a delegation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, provider, thinker, anthropicKeys, team } = setup([[{ tool: "relay" }]]);
    kiln.vault.setModelKey(team, "anthropic", "sk-ant-team", "test");
    const studio = studioFor(kiln)!;
    const created = await studio.createApp({ team, by: "dev@kiln.local", name: "Talky", source: { kind: "template", template: "test" } });
    await studio.ready(created.id);
    const { chat } = await studio.newChat(created.id, { by: "dev@kiln.local", via: "web" });
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer", app: created.id, chat: chat.id }))).json()) as {
      id: string;
    };
    expect(anthropicKeys).toEqual(["sk-ant-team"]);

    const link = provider.link("live_1");
    link.emit({ type: "started" });
    link.emit({ type: "input_transcript", text: "Make the button " });
    link.emit({ type: "input_transcript", text: "blue" });
    link.emit({ type: "delegation", id: "dlg_1" });
    await until(() => link.commands.some((c) => "delegation" in c && c.delegation === "dlg_1"), "the delegation's answer");

    expect(thinker.inputs[0]).toMatchObject({ words: "Make the button blue", focus: { app: created.id, chat: chat.id } });
    expect(studio.getChat(chat.id)!.turns.map((t) => ({ prompt: t.prompt, via: t.via }))).toEqual([{ prompt: "Make the button blue", via: "voice" }]);
    expect(session(kiln, id)).toMatchObject({ status: "live", transcript: [{ role: "person", text: "Make the button blue" }] });
    await studio.idle(chat.id);
  });

  it("narrates the team's Studio events over the sideband and streams badges", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, provider, team } = setup();
    const studio = studioFor(kiln)!;
    const ours = await studio.createApp({ team, by: "dev@kiln.local", name: "Ours", source: { kind: "template", template: "test" } });
    const theirs = await studio.createApp({ team: "team_other", by: "x", name: "Theirs", source: { kind: "template", template: "test" } });
    await Promise.all([studio.ready(ours.id), studio.ready(theirs.id)]);
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).json()) as { id: string };
    const events = reader(await app.request(`/api/v1/voice/sessions/${id}/events`));
    await events.until((t) => t.includes("event: state"));

    const publish = (type: string, payload: Record<string, unknown>) =>
      (kiln.bus as unknown as { publish(t: string, p: unknown): void }).publish(type, payload);
    publish("studio.needs_you", { appId: theirs.id, question: "Their question?" });
    publish("studio.needs_you", { appId: ours.id, chatId: "sc_1", question: "Allow this command? rm -f x" });
    const text = await events.until((t) => t.includes("event: badge"));
    await events.cancel();

    expect(provider.link("live_1").commands).toEqual([{ type: "say", text: "Allow this command? rm -f x", delegation: null }]);
    expect(text).toContain(JSON.stringify({ appId: ours.id, chatId: "sc_1", text: "Allow this command? rm -f x", priority: "needs_you" }));
    expect(text).not.toContain("Their question?");
  });

  it("mutes an idle session, wakes it on a PATCH and ends it after 30 minutes", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, clock, provider } = setup();
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).json()) as { id: string };
    const link = provider.link("live_1");
    link.emit({ type: "started" });

    clock.advance(119_000);
    voiceFor(kiln)!.tick();
    expect(link.commands).toEqual([]);
    clock.advance(1_000);
    voiceFor(kiln)!.tick();
    expect(link.commands).toEqual([{ type: "mute" }]);
    expect(session(kiln, id).status).toBe("idle");

    const patched = await app.request(`/api/v1/voice/sessions/${id}`, json("PATCH", { focus: { app: "sa_2", chat: "sc_2" }, quiet: true }));
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ status: "live", focus: { app: "sa_2", chat: "sc_2" }, quiet: true });
    expect(link.commands.at(-1)).toEqual({ type: "unmute" });

    clock.advance(30 * 60_000);
    voiceFor(kiln)!.tick();
    expect(link.commands.at(-1)).toEqual({ type: "close" });
    expect(session(kiln, id).status).toBe("closed");
  });

  it("DELETE closes the live session, and its usage is recorded when it has closed", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, provider } = setup();
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).json()) as { id: string };
    const link = provider.link("live_1");
    const res = await app.request(`/api/v1/voice/sessions/${id}`, json("DELETE"));
    expect(res.status).toBe(200);
    expect(link.commands).toEqual([{ type: "close" }]);
    expect(session(kiln, id).status).toBe("closed");

    link.emit({ type: "closed", usage: { seconds: 42, costUsd: 0.035 } });
    expect(session(kiln, id)).toMatchObject({ seconds: 42, costUsd: 0.035 });
    expect(link.detached).toBe(true);
  });

  it("resumes a session with a new live session seeded with the transcript and focus", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, provider } = setup();
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer", app: "sa_1" }))).json()) as { id: string };
    const first = provider.link("live_1");
    first.emit({ type: "input_transcript", text: "How is it going?" });
    first.emit({ type: "output_transcript", text: "Still working." });
    first.emit({ type: "closed" });

    const res = await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer 2", resume: id }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id, sdp: "answer:offer 2" });
    expect(provider.created[1]!.instructions).toContain("sa_1");
    const [seed] = provider.link("live_2").commands;
    expect(seed).toMatchObject({ type: "think", delegation: null });
    expect(seed && "text" in seed ? seed.text : "").toMatch(/Person: How is it going\?[\s\S]*You: Still working\.[\s\S]*sa_1/);
    expect(session(kiln, id)).toMatchObject({ liveSessionId: "live_2", status: "connecting" });
  });

  it("answers 404 for another team's or person's session", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, team, provider } = setup();
    const sessions = new VoiceSessionStore(kiln.store, kiln.clock);
    for (const other of [sessions.create({ team: "team_other", by: "dev@kiln.local" }), sessions.create({ team, by: "someone@else.test" })]) {
      expect((await app.request(`/api/v1/voice/sessions/${other.id}`, json("PATCH", { quiet: true }))).status).toBe(404);
      expect((await app.request(`/api/v1/voice/sessions/${other.id}`, json("DELETE"))).status).toBe(404);
      expect((await app.request(`/api/v1/voice/sessions/${other.id}/events`)).status).toBe(404);
      expect((await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer", resume: other.id }))).status).toBe(404);
    }
    expect(provider.created).toEqual([]);
  });

  it("lists its routes in the API reference: read to listen, send to change", () => {
    expect(voiceRoutes.every((r) => r.scope === (r.method === "get" ? "read" : "send"))).toBe(true);
    expect(ROUTES.filter((r) => r.path.startsWith("/api/v1/voice/")).map((r) => `${r.method} ${r.path}`)).toEqual([
      "post /api/v1/voice/sessions",
      "get /api/v1/voice/sessions/{id}/events",
      "patch /api/v1/voice/sessions/{id}",
      "delete /api/v1/voice/sessions/{id}",
    ]);
  });

  it("keeps a focus the person moved to while a delegation was thinking", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    let release!: () => void;
    const thinking = new Promise<void>((r) => (release = r));
    const inputs: ThinkInput[] = [];
    const slow: Thinker = {
      async think(input) {
        inputs.push(input);
        await thinking;
        return [{ tool: "reply", text: "Okay." }];
      },
    };
    const { app, kiln, provider } = setup([], slow);
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer", app: "sa_1", chat: "sc_1" }))).json()) as { id: string };
    const link = provider.link("live_1");
    link.emit({ type: "input_transcript", text: "what now?" });
    link.emit({ type: "delegation", id: "dlg_1" });
    await until(() => inputs.length === 1, "the thinker");

    await app.request(`/api/v1/voice/sessions/${id}`, json("PATCH", { focus: { app: "sa_2", chat: "sc_2" } }));
    release();
    await until(() => link.commands.some((c) => "delegation" in c && c.delegation === "dlg_1"), "the delegation's answer");
    expect(session(kiln, id).focus).toEqual({ app: "sa_2", chat: "sc_2" });
  });

  it("wakes an idle session when the person asks it to listen again", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, clock, provider } = setup();
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).json()) as { id: string };
    const link = provider.link("live_1");
    link.emit({ type: "started" });
    clock.advance(120_000);
    voiceFor(kiln)!.tick();
    expect(session(kiln, id).status).toBe("idle");

    const res = await app.request(`/api/v1/voice/sessions/${id}`, json("PATCH", { wake: true }));
    expect(await res.json()).toMatchObject({ status: "live" });
    expect(link.commands.at(-1)).toEqual({ type: "unmute" });
  });

  it("counts the session as live from its first sideband event, even without session.started", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, clock, provider } = setup();
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).json()) as { id: string };
    const link = provider.link("live_1");
    link.emit({ type: "input_transcript", text: "hello" });
    expect(session(kiln, id).status).toBe("live");
    clock.advance(120_000);
    voiceFor(kiln)!.tick();
    expect(link.commands).toEqual([{ type: "mute" }]);
  });

  it("relays only what the person said since the voice last answered", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, provider, thinker } = setup([[{ tool: "reply", text: "Okay." }]]);
    await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer", app: "sa_1", chat: "sc_1" }));
    const link = provider.link("live_1");
    link.emit({ type: "input_transcript", text: "hi, can you hear me?" });
    link.emit({ type: "output_transcript", text: "Yes, I can." });
    link.emit({ type: "input_transcript", text: "make the header red" });
    link.emit({ type: "output_transcript", text: "One moment." });
    link.emit({ type: "delegation", id: "dlg_1" });
    await until(() => link.commands.some((c) => "delegation" in c && c.delegation === "dlg_1"), "the delegation's answer");
    expect(thinker.inputs[0]!.words).toBe("make the header red");
  });

  it("closes a session that is still live when it is resumed, and records its usage", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, provider } = setup([[{ tool: "reply", text: "Okay." }]]);
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).json()) as { id: string };
    const first = provider.link("live_1");
    first.emit({ type: "started" });

    expect((await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer 2", resume: id }))).status).toBe(201);
    expect(first.commands).toEqual([{ type: "close" }]);
    expect(first.detached).toBe(false);

    // The old session's report adds its usage but doesn't end the resumed one.
    first.emit({ type: "closed", usage: { seconds: 29 * 60, costUsd: 1.45 } });
    expect(first.detached).toBe(true);
    expect(session(kiln, id)).toMatchObject({ status: "connecting", liveSessionId: "live_2", seconds: 29 * 60, costUsd: 1.45 });

    const second = provider.link("live_2");
    second.emit({ type: "input_transcript", text: "still there?" });
    second.emit({ type: "delegation", id: "dlg_2" });
    await until(() => second.commands.some((c) => "delegation" in c && c.delegation === "dlg_2"), "the delegation's answer");
    expect(session(kiln, id).status).toBe("live");
  });

  it("carries the session's length over a resume", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, clock, provider } = setup();
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).json()) as { id: string };
    provider.link("live_1").emit({ type: "closed", usage: { seconds: 29 * 60 } });
    await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer 2", resume: id }));
    clock.advance(60_000);
    voiceFor(kiln)!.tick();
    expect(provider.link("live_2").commands.at(-1)).toEqual({ type: "close" });
    expect(session(kiln, id).status).toBe("closed");
  });

  it("attaches again when the sideband drops, and ends the session when it can't", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-server-openai");
    const { app, kiln, clock, provider } = setup();
    const { id } = (await (await app.request("/api/v1/voice/sessions", json("POST", { sdp: "offer" }))).json()) as { id: string };
    const link = provider.link("live_1");
    link.emit({ type: "started" });
    link.emit({ type: "detached" });
    await until(() => provider.attached.length === 2, "the second attach");
    expect(provider.attached[1]).toEqual({ sessionId: "live_1", apiKey: "sk-server-openai" });
    expect(session(kiln, id).status).toBe("live");

    provider.attach = async () => {
      throw new Error("unreachable");
    };
    link.emit({ type: "detached" });
    clock.advance(5_000);
    voiceFor(kiln)!.tick();
    expect(session(kiln, id).status).toBe("live");
    clock.advance(30_000);
    voiceFor(kiln)!.tick();
    await until(() => session(kiln, id).status === "closed", "the session to end");
  });
});

describe("voiceThinker", () => {
  const options = (t: unknown) => (t as { options: { apiKey: string; baseURL?: string } }).options;

  it("uses the team's Anthropic key, then the server's, and never the OpenAI-compatible gateway", () => {
    const env = { LLM_GATEWAY_URL: "https://gateway.test", LLM_GATEWAY_KEY: "gw", ANTHROPIC_API_KEY: "sk-ant-server" };
    const team = voiceThinker(env)("sk-ant-team");
    expect(team).toBeInstanceOf(AnthropicThinker);
    expect(options(team)).toMatchObject({ apiKey: "sk-ant-team" });
    expect(options(team).baseURL).toBeUndefined();
    expect(options(voiceThinker(env)(undefined))).toMatchObject({ apiKey: "sk-ant-server" });
    expect(voiceThinker({ LLM_GATEWAY_URL: "https://gateway.test" })(undefined)).toBeUndefined();
  });
});
