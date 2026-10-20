"use client";

import { useEffect, useState } from "react";
import { AuthLink, AuthShell } from "@/components/kiln/auth-shell";
import { tokenFromFragment } from "@/lib/session";
import { adoptSession } from "../../login/actions";

/** GitHub login lands here with `#token=...`; the token moves into the httpOnly cookie and out of the URL. */
export default function AuthCallback() {
  const [error, setError] = useState<string>();
  useEffect(() => {
    const token = tokenFromFragment(window.location.hash);
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!token) {
      setError("GitHub did not send a session back.");
      return;
    }
    adoptSession(token, next).then(
      (r) => r?.error && setError(r.error),
      () => undefined,
    );
  }, []);
  return (
    <AuthShell title={error ? "Could not sign you in" : "Signing you in…"} subtitle={error} footer={error ? <AuthLink href="/login">Back to log in</AuthLink> : undefined}>
      {null}
    </AuthShell>
  );
}
