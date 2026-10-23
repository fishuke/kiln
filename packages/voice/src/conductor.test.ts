import type { ToolResult } from "@kiln/studio";
import { describe, expect, it } from "vitest";
import { Conductor, type ConductorState } from "./conductor";
import { FakeThinker } from "./thinker";
import type { ConductorCall } from "./types";

const clock = { now: () => new Date("2026-10-23T10:00:00.000Z") };
const state = (over: Partial<ConductorState> = {}): ConductorState => ({
  focus: { app: "a1", chat: "c1" },
  transcript: [],
  status: "Daily Done: idle.",
  ...over,
});

/** A conductor with a scripted thinker and a recording runTool. */
function setup(script: ConductorCall[][], results: Record<string, ToolResult> = {}) {
  const thinker = new FakeThinker(script);
  const calls: { name: string; input: Record<string, unknown> }[] = [];
  const conductor = new Conductor({
    thinker,
    clock,
    runTool: async (name, input) => {
      calls.push({ name, input });
      return results[name] ?? { ok: true, data: null };
    },
  });
  return { conductor, thinker, calls };
}

describe("Conductor", () => {
  it("relays the person's words verbatim to the focused chat", async () => {
    const { conductor, thinker, calls } = setup([[{ tool: "relay" }]]);
    const r = await conductor.handle(state(), "make the header um blue, like navy");
    expect(calls).toEqual([{ name: "send", input: { chat: "c1", text: "make the header um blue, like navy" } }]);
    expect(r).toMatchObject({ client: [], focus: { app: "a1", chat: "c1" } });
    expect(r.say).toBeUndefined();
    expect(thinker.inputs[0]).toMatchObject({ words: "make the header um blue, like navy", focus: { app: "a1", chat: "c1" }, status: "Daily Done: idle." });
  });

  it("relays to a named chat", async () => {
    const { conductor, calls } = setup([[{ tool: "relay", chat: "c9" }]]);
    await conductor.handle(state(), "add a footer");
    expect(calls).toEqual([{ name: "send", input: { chat: "c9", text: "add a footer" } }]);
  });

  it("asks which chat when there is nowhere to relay", async () => {
    const { conductor, calls } = setup([[{ tool: "relay" }]]);
    const r = await conductor.handle(state({ focus: { app: "a1" } }), "add a footer");
    expect(calls).toEqual([]);
    expect(r.say).toMatch(/which chat/i);
  });

  it("asks before apply and runs it only on a spoken yes", async () => {
    const version = { id: "v1", title: "Blue header" };
    const { conductor, calls } = setup([[{ tool: "studio", name: "apply", input: { chat: "c1" } }], [{ tool: "confirm", yes: true }]], {
      apply: { ok: true, data: { ok: true, version } },
    });
    const first = await conductor.handle(state(), "apply it");
    expect(calls).toEqual([]);
    expect(first.pending).toEqual({ name: "apply", input: { chat: "c1" }, asked: first.say });
    expect(first.say).toMatch(/apply/i);

    const second = await conductor.handle(state({ pending: first.pending }), "yes");
    expect(calls).toEqual([{ name: "apply", input: { chat: "c1" } }]);
    expect(second.pending).toBeUndefined();
    expect(second.say).toBe("Applied: Blue header.");
  });

  it("drops the pending action on a no, or when the next delegation is about something else", async () => {
    const pending = { name: "ship" as const, input: { app: "a1" }, asked: "Ship it?" };
    const no = setup([[{ tool: "confirm", yes: false }]]);
    const r = await no.conductor.handle(state({ pending }), "no");
    expect(no.calls).toEqual([]);
    expect(r.pending).toBeUndefined();
    expect(r.say).toMatch(/won't/);

    const other = setup([[{ tool: "relay" }]]);
    const r2 = await other.conductor.handle(state({ pending }), "make it red");
    expect(other.calls).toEqual([{ name: "send", input: { chat: "c1", text: "make it red" } }]);
    expect(r2.pending).toBeUndefined();
  });

  it("asks for restore and ship too", async () => {
    for (const [name, input] of [
      ["restore", { version: "v1" }],
      ["ship", { app: "a1" }],
    ] as const) {
      const { conductor, calls } = setup([[{ tool: "studio", name, input }]]);
      const r = await conductor.handle(state(), "do it");
      expect(calls).toEqual([]);
      expect(r.pending).toMatchObject({ name, input });
    }
  });

  it("turns a tool error into a short say", async () => {
    const { conductor } = setup([[{ tool: "studio", name: "stop", input: { chat: "c1" } }]], { stop: { ok: false, error: "unknown chat c1" } });
    expect((await conductor.handle(state(), "stop")).say).toBe("I couldn't stop that: unknown chat c1");
  });

  it("says a confirmed apply's conflict", async () => {
    const { conductor } = setup([[{ tool: "confirm", yes: true }]], { apply: { ok: true, data: { ok: false, conflict: ["a.ts", "b.ts"] } } });
    const r = await conductor.handle(state({ pending: { name: "apply", input: { chat: "c1" }, asked: "Apply?" } }), "yes");
    expect(r.say).toBe("Applying conflicts in a.ts, b.ts.");
  });

  it("turns a thinker failure into a short say", async () => {
    const thinker = { think: async () => Promise.reject(new Error("overloaded")) };
    const conductor = new Conductor({ thinker, clock, runTool: async () => ({ ok: true, data: null }) });
    expect((await conductor.handle(state(), "hi")).say).toBe("I couldn't work that out: overloaded");
  });

  it("summarizes status by plain code", async () => {
    const report = {
      apps: [
        { id: "a1", name: "Daily Done", working: ["c1"], needsYou: [{ chatId: "c2", question: "Which colour?" }], latest: { title: "Blue header", at: "x" } },
        { id: "a2", name: "Budget", working: [], needsYou: [] },
      ],
    };
    const { conductor } = setup([[{ tool: "studio", name: "status", input: { app: "a1" } }]], { status: { ok: true, data: report } });
    expect((await conductor.handle(state(), "how's it going?")).say).toBe(
      "Daily Done: 1 chat working; needs you: Which colour?; latest: Blue header. Budget: idle; latest: nothing yet.",
    );
  });

  it("says the preview's state from look", async () => {
    const { conductor } = setup([[{ tool: "studio", name: "look", input: { chat: "c1" } }]], {
      look: { ok: true, data: { target: "c1", url: "http://x", status: "ready" } },
    });
    expect((await conductor.handle(state(), "is the preview up?")).say).toBe("The preview is ready.");
  });

  it("fetches the status digest when the caller passes none", async () => {
    const { conductor, thinker, calls } = setup([[{ tool: "reply", text: "Hi." }]], {
      status: { ok: true, data: { apps: [{ id: "a1", name: "Daily Done", working: [], needsYou: [] }] } },
    });
    const r = await conductor.handle({ focus: {}, transcript: [] }, "hello");
    expect(calls).toEqual([{ name: "status", input: {} }]);
    expect(thinker.inputs[0]!.status).toBe("Daily Done (a1): idle; latest: nothing yet.");
    expect(r.say).toBe("Hi.");
  });

  it("returns client actions and moves the focus", async () => {
    const { conductor } = setup(
      [
        [
          { tool: "studio", name: "new_chat", input: { app: "a2" } },
          { tool: "studio", name: "show", input: { view: "hands_free" } },
        ],
      ],
      {
        new_chat: { ok: true, data: { chat: { id: "c7" } }, client: { focus: { app: "a2", chat: "c7" } } },
        show: { ok: true, data: null, client: { show: "hands_free" } },
      },
    );
    const r = await conductor.handle(state(), "start another chat in Budget");
    expect(r.client).toEqual([{ focus: { app: "a2", chat: "c7" } }, { show: "hands_free" }]);
    expect(r.focus).toEqual({ app: "a2", chat: "c7" });
  });

  it("relays to the chat a previous call in the same delegation opened", async () => {
    const { conductor, calls } = setup([[{ tool: "studio", name: "new_chat", input: { app: "a2" } }, { tool: "relay" }]], {
      new_chat: { ok: true, data: { chat: { id: "c7" } }, client: { focus: { app: "a2", chat: "c7" } } },
    });
    await conductor.handle(state(), "start a chat in Budget and add a login page");
    expect(calls[1]).toEqual({ name: "send", input: { chat: "c7", text: "start a chat in Budget and add a login page" } });
  });

  it("says open_app briefly and a reply as is; never runs send for the model", async () => {
    const { conductor, calls } = setup(
      [
        [
          { tool: "studio", name: "open_app", input: { app: "a2" } },
          { tool: "studio", name: "send", input: { chat: "c1", text: "model words" } },
          { tool: "reply", text: "There it is." },
        ],
      ],
      { open_app: { ok: true, data: { id: "a2", name: "Budget" }, client: { focus: { app: "a2" } } } },
    );
    const r = await conductor.handle(state(), "open Budget");
    expect(calls.map((c) => c.name)).toEqual(["open_app"]);
    expect(r.say).toBe("Opening Budget. There it is.");
    expect(r.focus).toEqual({ app: "a2" });
  });

  it("never changes the ship mode: only a person may, on the screen", async () => {
    const { conductor, calls } = setup([[{ tool: "studio", name: "set_ship_mode", input: { app: "a1", mode: "cowboy" } }]]);
    const r = await conductor.handle(state(), "switch to cowboy");
    expect(calls).toEqual([]);
    expect(r.pending).toBeUndefined();
    expect(r.say).toMatch(/ship mode/i);
  });

  it("starts a new chat without the model's words; the person's words go there by relay", async () => {
    const { conductor, calls } = setup([[{ tool: "studio", name: "new_chat", input: { app: "a2", prompt: "Make header sticky" } }, { tool: "relay" }]], {
      new_chat: { ok: true, data: { chat: { id: "c7" } }, client: { focus: { app: "a2", chat: "c7" } } },
    });
    await conductor.handle(state(), "start a new chat and make the header sticky with a blur");
    expect(calls).toEqual([
      { name: "new_chat", input: { app: "a2" } },
      { name: "send", input: { chat: "c7", text: "start a new chat and make the header sticky with a blur" } },
    ]);
  });

  it("runs a pending action only when the person said something", async () => {
    const pending = { name: "ship" as const, input: { app: "a1" }, asked: "Open or update the pull request? Say yes or no." };
    const { conductor, calls } = setup([[{ tool: "confirm", yes: true }]]);
    const r = await conductor.handle(state({ pending }), "  ");
    expect(calls).toEqual([]);
    expect(r.pending).toBeUndefined();
  });

  it("asks for confirmation only when the person said something", async () => {
    const { conductor, calls } = setup([[{ tool: "studio", name: "ship", input: { app: "a1" } }]]);
    const r = await conductor.handle(state(), "");
    expect(calls).toEqual([]);
    expect(r.pending).toBeUndefined();
  });
});
