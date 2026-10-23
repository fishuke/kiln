import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ error: [] as unknown[][], success: [] as unknown[][] }));
vi.mock("sonner", () => ({
  toast: Object.assign(() => 1, {
    error: (...a: unknown[]) => (calls.error.push(a), 1),
    success: (...a: unknown[]) => (calls.success.push(a), 1),
  }),
}));

const { toast } = await import("./toast");
const { TraceId } = await import("@/components/kiln/trace-id");

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";

/** The TraceId elements in a toast description. */
function traceIds(node: unknown): string[] {
  if (!isValidElement(node)) return Array.isArray(node) ? node.flatMap(traceIds) : [];
  const el = node as ReactElement<{ traceId?: string; children?: unknown }>;
  return el.type === TraceId ? [el.props.traceId!] : traceIds(el.props.children);
}

beforeEach(() => {
  calls.error.length = 0;
  calls.success.length = 0;
});

describe("error toasts", () => {
  it("show the trace id an error message carries under the message", () => {
    toast.error(`the app failed to start [trace ${ID}]`);
    const [message, data] = calls.error[0] as [string, { description: unknown }];
    expect(message).toBe("the app failed to start");
    expect(traceIds(data.description)).toEqual([ID]);
  });

  it("keep their own description next to the trace id", () => {
    toast.error(`invalid definition [trace ${ID}]`, { description: "agents.foreman: required" });
    const [, data] = calls.error[0] as [string, { description: ReactElement<{ children: unknown[] }> }];
    expect(JSON.stringify(data.description.props.children[0])).toContain("agents.foreman: required");
    expect(traceIds(data.description)).toEqual([ID]);
  });

  it("are unchanged without a trace id", () => {
    toast.error("unknown app sa_1", { duration: 5000 });
    expect(calls.error[0]).toEqual(["unknown app sa_1", { duration: 5000 }]);
  });

  it("leave the other toasts alone", () => {
    toast.success("App deleted");
    expect(calls.success[0]).toEqual(["App deleted"]);
  });
});
