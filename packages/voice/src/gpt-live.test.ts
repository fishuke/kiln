import { describe, expect, it } from "vitest";
import { FakeVoiceProvider } from "./fake";
import { GptLiveProvider, voiceInstructions, type LiveSocket } from "./gpt-live";
import { VoiceError, type VoiceEvent, type VoiceProvider } from "./types";

const key = "sk-live-secret";

/** A sideband socket the test drives: `serve` plays the server, `sent` holds what the client wrote. */
class FakeSocket implements LiveSocket {
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  private readonly listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
  }
  fire(type: "open" | "message" | "close" | "error", data?: unknown) {
    for (const l of this.listeners[type] ?? []) l({ data });
  }
  serve(event: unknown) {
    this.fire("message", typeof event === "string" ? event : JSON.stringify(event));
  }
}

function setup(response: { status: number; body: unknown } = { status: 201, body: { session: { id: "ls_1" }, transport: { sdp: "answer" } } }) {
  const requests: { url: string; init: RequestInit }[] = [];
  const sockets: FakeSocket[] = [];
  let n = 0;
  const provider = new GptLiveProvider({
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
    },
    socket: (url, headers) => {
      const socket = new FakeSocket(url, headers);
      sockets.push(socket);
      queueMicrotask(() => socket.fire("open"));
      return socket;
    },
    newId: () => `evt_${++n}`,
  });
  return { provider, requests, sockets };
}

async function attached() {
  const s = setup();
  const link = await s.provider.attach("ls_1", key);
  const events: VoiceEvent[] = [];
  link.on((e) => events.push(e));
  return { ...s, link, events, socket: s.sockets[0]! };
}

describe("GptLiveProvider.create", () => {
  it("posts the session with client delegation and returns the answer SDP", async () => {
    const { provider, requests } = setup();
    const created = await provider.create({ apiKey: key, sdp: "offer", instructions: "Be Kiln." });

    expect(created).toEqual({ sessionId: "ls_1", sdp: "answer" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.openai.com/v1/live/sessions");
    expect(requests[0]!.init.method).toBe("POST");
    expect(new Headers(requests[0]!.init.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({
      session: { model: "gpt-live-1", instructions: "Be Kiln.", delegation: { type: "client" } },
      transport: { type: "webrtc", sdp: "offer" },
    });
  });

  it("uses an injected base URL", async () => {
    const requests: string[] = [];
    const provider = new GptLiveProvider({
      baseUrl: "http://gateway.test/",
      fetch: async (url) => {
        requests.push(String(url));
        return new Response(JSON.stringify({ session: { id: "ls_9" }, transport: { sdp: "a" } }), { status: 201 });
      },
    });
    await provider.create({ apiKey: key, sdp: "o", instructions: "i" });
    expect(requests).toEqual(["http://gateway.test/v1/live/sessions"]);
  });

  it("turns a refusal into provider_failed with the provider's message and never the key", async () => {
    const { provider } = setup({ status: 401, body: { error: { message: `Incorrect API key provided: ${key}` } } });
    const error = await provider.create({ apiKey: key, sdp: "o", instructions: "i" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VoiceError);
    expect((error as VoiceError).code).toBe("provider_failed");
    expect((error as VoiceError).message).toContain("Incorrect API key provided");
    expect((error as VoiceError).message).toContain("401");
    expect((error as VoiceError).message).not.toContain(key);
  });

  it("treats a 200 or an unreadable body as provider_failed", async () => {
    const ok = setup({ status: 200, body: { session: { id: "ls_1" }, transport: { sdp: "a" } } });
    await expect(ok.provider.create({ apiKey: key, sdp: "o", instructions: "i" })).rejects.toMatchObject({ code: "provider_failed" });
    const odd = setup({ status: 201, body: { session: {} } });
    await expect(odd.provider.create({ apiKey: key, sdp: "o", instructions: "i" })).rejects.toMatchObject({ code: "provider_failed" });
  });

  it("turns a network failure into provider_failed", async () => {
    const provider = new GptLiveProvider({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(provider.create({ apiKey: key, sdp: "o", instructions: "i" })).rejects.toMatchObject({ code: "provider_failed" });
  });
});

describe("GptLiveProvider.attach", () => {
  it("opens the sideband with the bearer key", async () => {
    const { socket } = await attached();
    expect(socket.url).toBe("wss://api.openai.com/v1/live/sessions/ls_1/attach");
    expect(socket.headers).toEqual({ Authorization: `Bearer ${key}` });
  });

  it("fails with provider_failed when the sideband never opens", async () => {
    const provider = new GptLiveProvider({
      socket: (url, headers) => {
        const socket = new FakeSocket(url, headers);
        queueMicrotask(() => socket.fire("error"));
        return socket;
      },
    });
    await expect(provider.attach("ls_1", key)).rejects.toMatchObject({ code: "provider_failed" });
  });

  it("maps wire events to voice events, one per transcript delta", async () => {
    const { socket, events } = await attached();
    socket.serve({ type: "session.started", session: { id: "ls_1" } });
    socket.serve({ type: "session.input_transcript.delta", delta: "start a ", start_ms: 0, end_ms: 400 });
    socket.serve({ type: "session.input_transcript.delta", delta: "new chat", start_ms: 400, end_ms: 900 });
    socket.serve({ type: "session.output_transcript.delta", delta: "On it.", start_ms: 1000, end_ms: 1300 });
    socket.serve({ type: "session.delegation.created", offset_ms: 950, delegation: { id: "dg_1", target: "client" } });
    socket.serve({ type: "session.closed", usage: { seconds: 61, cost_usd: 0.05 } });

    expect(events).toEqual([
      { type: "started" },
      { type: "input_transcript", text: "start a " },
      { type: "input_transcript", text: "new chat" },
      { type: "output_transcript", text: "On it." },
      { type: "delegation", id: "dg_1" },
      { type: "closed", usage: { seconds: 61, costUsd: 0.05 } },
    ]);
  });

  it("ignores unknown event types, acks and unreadable frames", async () => {
    const { socket, events } = await attached();
    socket.serve({ type: "session.commentary.appended", client_event_id: "evt_1" });
    socket.serve({ type: "session.something_new", x: 1 });
    socket.serve("not json");
    expect(events).toEqual([]);
  });

  it("reports a known event with a bad shape and a provider error as errors", async () => {
    const { socket, events } = await attached();
    socket.serve({ type: "session.delegation.created", delegation: {} });
    socket.serve({ type: "error", error: { message: "Rate limited" } });
    expect(events.map((e) => e.type)).toEqual(["error", "error"]);
    expect(events[1]).toEqual({ type: "error", message: "Rate limited" });
  });

  it("reports a sideband that drops before session.closed", async () => {
    const { socket, events } = await attached();
    socket.fire("close");
    expect(events).toEqual([{ type: "error", message: expect.stringContaining("closed") }]);
  });

  it("maps commands to wire commands with generated event ids", async () => {
    const { socket, link } = await attached();
    link.send({ type: "say", text: "Opening Daily Done.", delegation: "dg_1" });
    link.send({ type: "think", text: "The build finished.", delegation: null });
    link.send({ type: "instruct", text: "The person is in Daily Done." });
    link.send({ type: "mute" });
    link.send({ type: "unmute" });
    link.send({ type: "close" });

    expect(socket.sent).toEqual([
      { type: "session.commentary.append", event_id: "evt_1", delegation_id: "dg_1", content: "Opening Daily Done." },
      { type: "session.thinking.append", event_id: "evt_2", delegation_id: null, content: "The build finished." },
      { type: "session.instructions.append", event_id: "evt_3", content: "The person is in Daily Done." },
      { type: "session.input_audio.mute", event_id: "evt_4" },
      { type: "session.input_audio.unmute", event_id: "evt_5" },
      { type: "session.close", event_id: "evt_6" },
    ]);
  });

  it("clips content to 1800 characters", async () => {
    const { socket, link } = await attached();
    link.send({ type: "say", text: "a".repeat(5000), delegation: null });
    link.send({ type: "instruct", text: "b".repeat(1801) });
    expect((socket.sent[0]!.content as string).length).toBe(1800);
    expect((socket.sent[1]!.content as string).length).toBe(1800);
  });

  it("detach closes the socket, stops events and refuses further commands", async () => {
    const { socket, link, events } = await attached();
    link.detach();
    expect(socket.closed).toBe(true);
    socket.serve({ type: "session.started" });
    socket.fire("close");
    expect(events).toEqual([]);
    expect(() => link.send({ type: "mute" })).toThrow(VoiceError);
  });

  it("unsubscribes a listener", async () => {
    const { socket, link } = await attached();
    const seen: VoiceEvent[] = [];
    const off = link.on((e) => seen.push(e));
    off();
    socket.serve({ type: "session.started" });
    expect(seen).toEqual([]);
  });
});

describe("voiceInstructions", () => {
  it("says the voice delegates, never acts, stays short and does not talk over the person", () => {
    const text = voiceInstructions({});
    expect(text).toContain("Kiln Studio");
    expect(text).toMatch(/never decide or act/i);
    expect(text).toMatch(/delegate/i);
    expect(text).toMatch(/short/i);
    expect(text).toMatch(/talk over/i);
  });

  it("names the focus when there is one", () => {
    expect(voiceInstructions({ app: "app_1", chat: "chat_2" })).toContain("chat_2");
    expect(voiceInstructions({ app: "app_1" })).toContain("app_1");
  });
});

describe("FakeVoiceProvider", () => {
  it("creates sessions, records commands and lets a test emit events", async () => {
    const provider: VoiceProvider = new FakeVoiceProvider();
    const fake = provider as FakeVoiceProvider;
    const created = await provider.create({ apiKey: key, sdp: "offer", instructions: "i" });
    expect(created.sessionId).toBeTruthy();
    expect(fake.created).toEqual([{ apiKey: key, sdp: "offer", instructions: "i" }]);

    const link = await provider.attach(created.sessionId, key);
    const events: VoiceEvent[] = [];
    link.on((e) => events.push(e));
    link.send({ type: "say", text: "Hi", delegation: null });

    const fakeLink = fake.link(created.sessionId);
    expect(fakeLink.commands).toEqual([{ type: "say", text: "Hi", delegation: null }]);
    fakeLink.emit({ type: "delegation", id: "dg_1" });
    expect(events).toEqual([{ type: "delegation", id: "dg_1" }]);

    link.detach();
    expect(fakeLink.detached).toBe(true);
    expect(() => link.send({ type: "mute" })).toThrow(VoiceError);
  });

  it("refuses to attach to a session it never created", async () => {
    await expect(new FakeVoiceProvider().attach("nope", key)).rejects.toMatchObject({ code: "not_found" });
  });
});
