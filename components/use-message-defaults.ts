"use client";

import { useEffect, useState } from "react";
import { BUILT_IN_DEFAULTS, type MessageDefaults } from "@/lib/message-defaults";

let cached: MessageDefaults | null = null;
const listeners = new Set<(d: MessageDefaults) => void>();

/** Tell every mounted reader that the defaults changed (after a save). */
export function publishMessageDefaults(next: MessageDefaults) {
  cached = next;
  listeners.forEach((fn) => fn(next));
}

/**
 * The workspace's default message wording (Settings → Default messages).
 * Starts on the built-in text and updates once loaded.
 */
export function useMessageDefaults(): { defaults: MessageDefaults; loaded: boolean } {
  const [defaults, setDefaults] = useState<MessageDefaults>(cached ?? BUILT_IN_DEFAULTS);
  const [loaded, setLoaded] = useState(Boolean(cached));

  useEffect(() => {
    const listener = (d: MessageDefaults) => {
      setDefaults(d);
      setLoaded(true);
    };
    listeners.add(listener);
    if (!cached) {
      fetch("/api/workspace/message-defaults")
        .then((r) => r.json())
        .then((d) => {
          if (d.success) publishMessageDefaults(d.data.values);
        })
        .catch(() => {});
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { defaults, loaded };
}
