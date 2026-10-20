import { describe, expect, it } from "vitest";
import { effectiveToken, isAuthPage, isPublicPath, isSecureRequest, safeNext, SESSION_MAX_AGE, sessionCookieOptions, tokenFromFragment, validTeam } from "./session";

describe("session cookies", () => {
  it("is httpOnly and SameSite=Lax, secure only on https", () => {
    const o = sessionCookieOptions({ secure: false });
    expect(o).toMatchObject({ httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: SESSION_MAX_AGE });
    expect(sessionCookieOptions({ secure: true }).secure).toBe(true);
  });

  it("never outlives the API session", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    expect(sessionCookieOptions({ secure: false, expiresAt: "2026-10-21T00:00:00Z", now }).maxAge).toBe(86_400);
    expect(sessionCookieOptions({ secure: false, expiresAt: "2030-01-01T00:00:00Z", now }).maxAge).toBe(SESSION_MAX_AGE);
    expect(sessionCookieOptions({ secure: false, expiresAt: "2026-10-19T00:00:00Z", now }).maxAge).toBe(0);
    expect(sessionCookieOptions({ secure: false, expiresAt: "nonsense", now }).maxAge).toBe(SESSION_MAX_AGE);
  });

  it("detects https directly or behind a proxy", () => {
    expect(isSecureRequest("https://kiln.example.com/login")).toBe(true);
    expect(isSecureRequest("http://localhost:3000/login")).toBe(false);
    expect(isSecureRequest("http://web:3000/login", "https")).toBe(true);
    expect(isSecureRequest("https://x/login", "http, https")).toBe(false);
  });

  it("prefers the session token over the server token", () => {
    expect(effectiveToken("sess", "server")).toBe("sess");
    expect(effectiveToken(undefined, "server")).toBe("server");
    expect(effectiveToken("  ", undefined)).toBeUndefined();
  });
});

describe("paths and redirects", () => {
  it("knows which pages need no session", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/invite/abc")).toBe(true);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/settings")).toBe(false);
    expect(isAuthPage("/signup")).toBe(true);
    expect(isAuthPage("/docs")).toBe(false);
  });

  it("only allows relative post-login destinations", () => {
    expect(safeNext("/runs?x=1")).toBe("/runs?x=1");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/login")).toBe("/");
    expect(safeNext(undefined, "/inbox")).toBe("/inbox");
  });

  it("reads the token from the GitHub callback fragment", () => {
    expect(tokenFromFragment("#token=kiln_abc%2B1")).toBe("kiln_abc+1");
    expect(tokenFromFragment("token=x&y=1")).toBe("x");
    expect(tokenFromFragment("#nothing=1")).toBeUndefined();
  });

  it("accepts only plain team ids", () => {
    expect(validTeam("team_mvgr")).toBe("team_mvgr");
    expect(validTeam("payments")).toBe("payments");
    expect(validTeam("a b")).toBeUndefined();
    expect(validTeam("x".repeat(65))).toBeUndefined();
    expect(validTeam(null)).toBeUndefined();
  });
});
