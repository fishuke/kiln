import { MemoryStore } from "@kiln/store";
import { describe, expect, it } from "vitest";
import { can, issueToken, parseGrants, revokeToken, verifyToken } from "./index";

describe("scoped tokens", () => {
  const store = new MemoryStore();

  it("verifies a token and checks per-factory scopes", () => {
    const { token } = issueToken(store, { name: "po", subject: "po@acme.test", grants: parseGrants("read:webapp,decide:preview:webapp") });
    const record = verifyToken(store, token);
    expect(record?.subject).toBe("po@acme.test");
    expect(can(record, "decide:preview", "webapp")).toBe(true);
    expect(can(record, "decide:preview", "payments")).toBe(false);
    expect(can(record, "definitions:write", "webapp")).toBe(false);
  });

  it("rejects tampered, expired and revoked tokens", () => {
    const { token, record } = issueToken(store, { name: "t", subject: "s", grants: [{ scope: "read", factory: "*" }], ttlHours: 1 });
    expect(verifyToken(store, token.slice(0, -2) + "xx")).toBeUndefined();
    expect(verifyToken(store, token, new Date(Date.now() + 2 * 3600_000))).toBeUndefined();
    revokeToken(store, record.id);
    expect(verifyToken(store, token)).toBeUndefined();
  });

  it("admin grants every scope, wildcard factories match all", () => {
    expect(can({ grants: [{ scope: "admin", factory: "*" }] }, "definitions:write", "webapp")).toBe(true);
    expect(can({ grants: [{ scope: "read", factory: "webapp" }] }, "read", "*")).toBe(false);
  });

  it("rejects unknown scopes", () => {
    expect(() => parseGrants("merge:webapp")).toThrow("unknown scope merge");
  });
});
