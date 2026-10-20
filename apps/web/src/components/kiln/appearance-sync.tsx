"use client";

import { useEffect } from "react";
import { useTheme, type ThemePreference } from "./theme";

const KEY = "kiln-theme";

/** On a browser that has no local theme choice yet, adopt the one saved on the account. */
export function AppearanceSync({ appearance }: { appearance?: ThemePreference }) {
  const [, setPref] = useTheme();
  useEffect(() => {
    if (!appearance) return;
    try {
      if (localStorage.getItem(KEY) === null) setPref(appearance);
    } catch {
      /* storage blocked */
    }
  }, [appearance, setPref]);
  return null;
}
