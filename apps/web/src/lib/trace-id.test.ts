import { describe, expect, it } from "vitest";
import { splitTrace, withTrace } from "./trace-id";

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";

describe("trace ids in error messages", () => {
  it("appends a trace id and splits it off again", () => {
    const message = withTrace("the app failed to start", ID);
    expect(message).toBe(`the app failed to start [trace ${ID}]`);
    expect(splitTrace(message)).toEqual({ message: "the app failed to start", traceId: ID });
  });

  it("leaves a message without a trace id alone", () => {
    expect(withTrace("unknown app sa_1", undefined)).toBe("unknown app sa_1");
    expect(splitTrace("unknown app sa_1")).toEqual({ message: "unknown app sa_1" });
    expect(splitTrace("see [trace not-an-id]")).toEqual({ message: "see [trace not-an-id]" });
  });

  it("adds a trace id only once", () => {
    expect(withTrace(withTrace("boom", ID), "0af7651916cd43dd8448eb211c80319c")).toBe(`boom [trace ${ID}]`);
  });
});
