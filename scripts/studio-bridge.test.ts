// The Studio bridge in the Next.js template (templates/nextjs/public/kiln-bridge.js), run against a
// stand-in for the page: enough of window, document and elements for what the bridge touches.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(join(import.meta.dirname, "../templates/nextjs/public/kiln-bridge.js"), "utf8");

type Listener = (event: Record<string, unknown>) => void;

class El {
  style: Record<string, string> = { outline: "", outlineOffset: "" };
  scrolled = 0;
  constructor(
    readonly fragment?: string,
    readonly parent?: El,
  ) {}
  getAttribute(name: string) {
    return name === "data-kiln-fragment" ? (this.fragment ?? null) : null;
  }
  closest(selector: string): El | null {
    if (selector !== "[data-kiln-fragment]") throw new Error(`unexpected selector ${selector}`);
    return this.fragment !== undefined ? this : (this.parent?.closest(selector) ?? null);
  }
  scrollIntoView() {
    this.scrolled += 1;
  }
}

function page(elements: El[], framed = true) {
  const sent: unknown[] = [];
  const parent = { postMessage: (message: unknown, origin: string) => sent.push({ message, origin }) };
  const onWindow = new Map<string, Listener>();
  const onDocument = new Map<string, { fn: Listener; capture: unknown }>();
  const window: Record<string, unknown> = { addEventListener: (type: string, fn: Listener) => onWindow.set(type, fn) };
  window.parent = framed ? parent : window;
  const document = {
    documentElement: new El(),
    querySelectorAll: (selector: string) => {
      if (selector !== "[data-kiln-fragment]") throw new Error(`unexpected selector ${selector}`);
      return elements.filter((e) => e.fragment !== undefined);
    },
    addEventListener: (type: string, fn: Listener, capture: unknown) => onDocument.set(type, { fn, capture }),
    removeEventListener: (type: string) => onDocument.delete(type),
  };
  runInNewContext(SOURCE, { window, document, setTimeout, clearTimeout });
  const tell = (data: unknown, source: unknown = parent) => onWindow.get("message")?.({ data, source });
  const fire = (type: string, target: El) => {
    const event = { target, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    onDocument.get(type)?.fn(event);
    return event;
  };
  return { sent, tell, fire, onDocument, onWindow, document };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Studio's bridge in the App template", () => {
  it("says it is ready when it loads", () => {
    expect(page([]).sent).toEqual([{ message: { type: "kiln:ready" }, origin: "*" }]);
  });

  it("does nothing outside a frame", () => {
    const p = page([], false);
    expect(p.sent).toEqual([]);
    expect(p.onWindow.size).toBe(0);
  });

  it("outlines every element of a fragment for two seconds and scrolls to the first", () => {
    const a = new El("f1");
    const b = new El("f1");
    const other = new El("f2");
    b.style.outline = "1px dotted red";
    const p = page([a, other, b]);
    p.tell({ type: "kiln:highlight", fragment: "f1" });
    expect(a.style.outline).toContain("solid");
    expect(b.style.outline).toContain("solid");
    expect(other.style.outline).toBe("");
    expect([a.scrolled, b.scrolled]).toEqual([1, 0]);
    vi.advanceTimersByTime(1999);
    expect(a.style.outline).toContain("solid");
    vi.advanceTimersByTime(1);
    expect(a.style.outline).toBe("");
    expect(b.style.outline).toBe("1px dotted red");
  });

  it("ignores messages that are not from the page that frames it, and ones it doesn't know", () => {
    const a = new El("f1");
    const p = page([a]);
    p.tell({ type: "kiln:highlight", fragment: "f1" }, { postMessage: () => undefined });
    p.tell({ type: "kiln:inspect", on: true }, {});
    p.tell({ type: "kiln:highlight", fragment: 7 });
    p.tell({ type: "kiln:inspect", on: "yes" });
    p.tell("kiln:inspect");
    p.tell(null);
    expect(a.style.outline).toBe("");
    expect(p.onDocument.size).toBe(0);
  });

  it("in inspect mode, a click picks the nearest fragment instead of pressing what was clicked", () => {
    const card = new El("f1");
    const button = new El(undefined, card);
    const plain = new El();
    const p = page([card]);
    p.tell({ type: "kiln:inspect", on: true });
    expect(p.onDocument.get("click")?.capture).toBe(true);
    expect(p.document.documentElement.style.cursor).toBe("crosshair");

    p.fire("mouseover", button);
    expect(card.style.outline).toContain("solid");
    p.fire("mouseover", plain);
    expect(card.style.outline).toBe("");

    const missed = p.fire("click", plain);
    expect(missed.preventDefault).toHaveBeenCalled();
    expect(p.sent).toHaveLength(1);

    const hit = p.fire("click", button);
    expect(hit.preventDefault).toHaveBeenCalled();
    expect(hit.stopPropagation).toHaveBeenCalled();
    expect(p.sent.at(-1)).toEqual({ message: { type: "kiln:fragment", fragment: "f1" }, origin: "*" });

    p.fire("mouseover", button);
    p.tell({ type: "kiln:inspect", on: false });
    expect(p.onDocument.size).toBe(0);
    expect(card.style.outline).toBe("");
    expect(p.document.documentElement.style.cursor).toBe("");
  });
});
