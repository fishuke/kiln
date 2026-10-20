"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
const KEY = "kiln-theme";

/** Runs before paint so the page never flashes the wrong theme. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("${KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

function apply(pref: ThemePreference) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme(): [ThemePreference, (p: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>("system");
  useEffect(() => {
    try {
      setPref((localStorage.getItem(KEY) as ThemePreference | null) ?? "system");
    } catch {
      /* storage blocked */
    }
  }, []);
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);
  const set = useCallback((p: ThemePreference) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* storage blocked */
    }
    apply(p);
  }, []);
  return [pref, set];
}
