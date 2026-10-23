import { KilnApiError } from "@kiln/sdk-ts";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorMessage } from "./error-message";

const API_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(new BasicTracerProvider());
});
afterAll(() => {
  trace.disable();
  context.disable();
});

describe("errorMessage", () => {
  it("carries the API's trace id", () => {
    const err = new KilnApiError(503, "the app failed to start", { error: "the app failed to start", traceId: API_TRACE });
    expect(errorMessage(err)).toBe(`the app failed to start [trace ${API_TRACE}]`);
  });

  it("carries the web's own trace id for an error in the web", () => {
    const traceId = trace.getTracer("test").startActiveSpan("server action", (span) => {
      const id = span.spanContext().traceId;
      expect(errorMessage(new Error("Unexpected Studio response"))).toBe(`Unexpected Studio response [trace ${id}]`);
      span.end();
      return id;
    });
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("has no trace id outside a traced request", () => {
    expect(errorMessage(new KilnApiError(404, "unknown app sa_1", { error: "unknown app sa_1" }))).toBe("unknown app sa_1");
  });

  it("joins validation issues", () => {
    const err = new KilnApiError(400, "invalid request", { error: "invalid request", issues: ["name: required", "source.repo: a repository as owner/name"] });
    expect(errorMessage(err)).toBe("name: required; source.repo: a repository as owner/name");
  });
});
