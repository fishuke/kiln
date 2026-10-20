"use server";

import { redirect } from "next/navigation";
import { api, errorMessage } from "@/lib/kiln";
import { safeNext } from "@/lib/session";
import { setSession, webOrigin } from "@/lib/web-session";

export type AuthState = { error?: string; email?: string; name?: string };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function login(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };
  try {
    const s = await api.withToken("").login(email, password);
    await setSession(s.token, s.expiresAt);
  } catch (err) {
    const msg = errorMessage(err);
    return { error: /invalid|password|credentials|401/i.test(msg) ? "That email and password don't match an account." : msg, email };
  }
  redirect(safeNext(str(form, "next")));
}

export async function signup(_prev: AuthState, form: FormData): Promise<AuthState> {
  const name = str(form, "name");
  const email = str(form, "email");
  const password = String(form.get("password") ?? "");
  const invite = str(form, "invite") || undefined;
  if (password.length < 8) return { error: "Use at least 8 characters for your password.", email, name };
  try {
    const s = await api.withToken("").signup({ name: name || undefined, email, password, invite });
    await setSession(s.token, s.expiresAt);
  } catch (err) {
    return { error: errorMessage(err), email, name };
  }
  redirect(safeNext(str(form, "next")));
}

/** Starts GitHub login: the API sends people back to /auth/callback with the token in the fragment. */
export async function githubLogin(form: FormData) {
  const next = safeNext(str(form, "next"));
  const invite = str(form, "invite") || undefined;
  const origin = await webOrigin();
  const { url } = await api.withToken("").githubLoginUrl({ redirect: `${origin}/auth/callback?next=${encodeURIComponent(next)}`, invite });
  redirect(url);
}

/** Called by /auth/callback with the token from the URL fragment. */
export async function adoptSession(token: string, next: string): Promise<{ error?: string }> {
  try {
    await api.withToken(token).me();
  } catch (err) {
    return { error: errorMessage(err) };
  }
  await setSession(token);
  redirect(safeNext(next));
}
