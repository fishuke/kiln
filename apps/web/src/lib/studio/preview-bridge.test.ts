import { describe, expect, it, vi } from "vitest";
import { dueHighlight, HIGHLIGHT_WAIT_MS, readFrameMessage, sendToFrame } from "./preview-bridge";

const frame = { postMessage: vi.fn() } as unknown as Window;

describe("the prototype bridge, on the page", () => {
  it("reads ready and a picked fragment from the frame", () => {
    expect(readFrameMessage({ source: frame, data: { type: "kiln:ready" } }, frame)).toEqual({ type: "kiln:ready" });
    expect(readFrameMessage({ source: frame, data: { type: "kiln:fragment", fragment: "f1" } }, frame)).toEqual({ type: "kiln:fragment", fragment: "f1" });
  });

  it("ignores a message from any other window, or with no frame", () => {
    const other = { postMessage: vi.fn() };
    expect(readFrameMessage({ source: other, data: { type: "kiln:ready" } }, frame)).toBeUndefined();
    expect(readFrameMessage({ source: null, data: { type: "kiln:ready" } }, null)).toBeUndefined();
    expect(readFrameMessage({ source: undefined, data: { type: "kiln:ready" } }, undefined)).toBeUndefined();
  });

  it("ignores what is not a bridge message", () => {
    for (const data of [null, "kiln:ready", 7, {}, { type: "kiln:inspect", on: true }, { type: "kiln:fragment" }, { type: "kiln:fragment", fragment: "" }, { type: "kiln:fragment", fragment: 3 }, { type: "kiln:fragment", fragment: "x".repeat(201) }])
      expect(readFrameMessage({ source: frame, data }, frame), JSON.stringify(data)).toBeUndefined();
  });

  it("sends to the frame, and says when there is none", () => {
    const post = vi.fn();
    expect(sendToFrame({ postMessage: post }, { type: "kiln:highlight", fragment: "f1" })).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: "kiln:highlight", fragment: "f1" }, "*");
    expect(sendToFrame(null, { type: "kiln:inspect", on: true })).toBe(false);
  });

  it("keeps a highlight for a frame that is loading, but not for long", () => {
    expect(dueHighlight(undefined, 1000)).toBeUndefined();
    expect(dueHighlight({ fragment: "f1", at: 1000 }, 1000 + HIGHLIGHT_WAIT_MS)).toBe("f1");
    expect(dueHighlight({ fragment: "f1", at: 1000 }, 1001 + HIGHLIGHT_WAIT_MS)).toBeUndefined();
  });
});
