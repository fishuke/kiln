import { MemoryStore } from "@kiln/store";
import { describe, expect, it } from "vitest";
import { can, FakeGitHubOAuth, grantsForFactoryRole, hashPassword, issueToken, maxFactoryRole, teamRoleAllows, verifyPassword, verifyToken } from "./index";

describe("passwords", () => {
  it("hashes with scrypt and a salt, and verifies", () => {
    const h = hashPassword("correct horse");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(hashPassword("correct horse")).not.toBe(h);
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong horse", h)).toBe(false);
    expect(verifyPassword("x", undefined)).toBe(false);
  });

  it("rejects short passwords", () => {
    expect(() => hashPassword("short")).toThrow("at least 8");
  });
});

describe("factory roles", () => {
  it("map onto scopes", () => {
    const user = { grants: grantsForFactoryRole("user", "web") };
    expect(can(user, "send", "web")).toBe(true);
    expect(can(user, "decide:preview", "web")).toBe(true);
    expect(can(user, "definitions:write", "web")).toBe(false);
    const editor = { grants: grantsForFactoryRole("editor", "web") };
    expect(can(editor, "definitions:write", "web")).toBe(true);
    expect(can(editor, "admin", "web")).toBe(false);
    expect(can({ grants: grantsForFactoryRole("admin", "web") }, "admin", "web")).toBe(true);
  });

  it("the highest role wins; team members may read and send team-wide", () => {
    expect(maxFactoryRole("user", undefined, "editor")).toBe("editor");
    expect(teamRoleAllows("member", "send")).toBe(true);
    expect(teamRoleAllows("member", "definitions:write")).toBe(false);
    expect(teamRoleAllows("admin", "admin")).toBe(true);
    expect(teamRoleAllows(undefined, "read")).toBe(false);
  });
});

describe("typed tokens", () => {
  it("records type, user and last use", () => {
    const store = new MemoryStore();
    const { token, record } = issueToken(store, { name: "laptop", subject: "a@x.test", grants: [], type: "personal", userId: "usr_1" });
    expect(record).toMatchObject({ type: "personal", userId: "usr_1" });
    expect(token.startsWith("kiln_tok_")).toBe(true);
    const now = new Date("2026-10-20T10:00:00Z");
    expect(verifyToken(store, token, now)?.lastUsedAt).toBe(now.toISOString());
  });
});

describe("GitHub OAuth fake", () => {
  it("exchanges known codes only", async () => {
    const gh = new FakeGitHubOAuth();
    gh.codes.set("c1", { id: "1", login: "alice", email: "alice@x.test" });
    expect(gh.authorizeUrl("s", "http://cb")).toContain("state=s");
    expect((await gh.exchange("c1")).login).toBe("alice");
    await expect(gh.exchange("nope")).rejects.toThrow("bad_verification_code");
  });
});
