import { STUDIO_TOOLS } from "@kiln/studio";
import { describe, expect, it } from "vitest";
import { AnthropicThinker, FakeThinker, thinkerTools } from "./thinker";
import type { ThinkInput } from "./types";

const input: ThinkInput = {
  words: "how's Daily Done doing?",
  transcript: [{ role: "person", text: "hi", at: "2026-10-23T10:00:00.000Z" }],
  focus: { app: "a1", chat: "c1" },
  status: "Daily Done (a1): idle; latest: nothing yet.",
};

/** A server-sent event stream as the Messages API sends it, with the given tool_use blocks. */
function sse(blocks: { name: string; input: unknown }[]): string {
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 9, output_tokens: 1 },
        },
      },
    ],
  ];
  blocks.forEach((b, index) => {
    const json = JSON.stringify(b.input);
    events.push([
      "content_block_start",
      { type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_${index}`, name: b.name, input: {} } },
    ]);
    // Split the input JSON in two deltas, as the API streams it.
    const half = Math.floor(json.length / 2);
    for (const part of [json.slice(0, half), json.slice(half)])
      events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: part } }]);
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function thinkerWith(blocks: { name: string; input: unknown }[]) {
  const requests: { url: string; body: Record<string, any> }[] = [];
  const thinker = new AnthropicThinker({
    apiKey: "sk-test",
    baseURL: "https://gateway.test",
    model: "claude-haiku-5-5",
    fetch: (async (url: string, init: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(sse(blocks), { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch,
  });
  return { thinker, requests };
}

describe("AnthropicThinker", () => {
  it("asks the decision model with cached system and tools, tool_choice any and a small budget, streaming", async () => {
    const { thinker, requests } = thinkerWith([{ name: "relay", input: {} }]);
    await thinker.think(input);
    const [{ url, body }] = requests as [(typeof requests)[number]];
    expect(url).toBe("https://gateway.test/v1/messages");
    expect(body).toMatchObject({ model: "claude-haiku-5-5", stream: true, tool_choice: { type: "any" } });
    expect(body.max_tokens).toBeLessThanOrEqual(1024);
    expect(body.system).toEqual([expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } })]);
    expect(body.tools.at(-1).cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools.slice(0, -1).every((t: { cache_control?: unknown }) => !t.cache_control)).toBe(true);
    const text = JSON.stringify(body.messages);
    for (const part of ["how's Daily Done doing?", "Daily Done (a1)", "c1"]) expect(text).toContain(part);
  });

  it("offers relay, confirm, reply and every Studio tool except send and set_ship_mode, with real input schemas", () => {
    const tools = thinkerTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["relay", "confirm", "reply", ...STUDIO_TOOLS.map((t) => t.name).filter((n) => n !== "send" && n !== "set_ship_mode")]);
    for (const t of tools) expect(t.input_schema.type).toBe("object");
    const newChat = tools.find((t) => t.name === "new_chat")!;
    expect(newChat.input_schema).toMatchObject({ properties: { app: { type: "string" } }, required: ["app"] });
    // The model never writes a chat's first message; relay sends the person's words.
    expect(Object.keys(newChat.input_schema.properties as object)).not.toContain("prompt");
    expect(newChat.description).not.toMatch(/first message/);
    // open_app is a union: one object with both branches' fields.
    const openApp = tools.find((t) => t.name === "open_app")!;
    expect(Object.keys(openApp.input_schema.properties as object)).toEqual(expect.arrayContaining(["app", "name", "source"]));
    expect(JSON.stringify(tools)).not.toContain("$schema");
  });

  it("maps tool_use blocks to conductor calls", async () => {
    const { thinker } = thinkerWith([
      { name: "new_chat", input: { app: "a2" } },
      { name: "relay", input: { chat: "c7" } },
      { name: "confirm", input: { yes: true } },
      { name: "reply", input: { text: "Done." } },
    ]);
    expect(await thinker.think(input)).toEqual([
      { tool: "studio", name: "new_chat", input: { app: "a2" } },
      { tool: "relay", chat: "c7" },
      { tool: "confirm", yes: true },
      { tool: "reply", text: "Done." },
    ]);
  });

  it("rejects a call that doesn't fit ConductorCall", async () => {
    const { thinker } = thinkerWith([{ name: "reply", input: { text: "" } }]);
    await expect(thinker.think(input)).rejects.toThrow(/reply/);
  });
});

describe("FakeThinker", () => {
  it("answers from its script in order and records inputs", async () => {
    const fake = new FakeThinker([[{ tool: "relay" }], [{ tool: "reply", text: "ok" }]]);
    expect(await fake.think(input)).toEqual([{ tool: "relay" }]);
    expect(await fake.think(input)).toEqual([{ tool: "reply", text: "ok" }]);
    await expect(fake.think(input)).rejects.toThrow(/script/);
    expect(fake.inputs).toHaveLength(3);
  });
});
