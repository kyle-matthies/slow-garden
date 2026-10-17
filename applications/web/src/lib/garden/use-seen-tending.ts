"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EMPTY_TENDING, type Tending } from "./scene/tending";

const EVENT = "slow-garden:blooms-seen";
const fallback = new Map<string, string>();
const serverSnapshot = () => "";

function snapshot(key: string) {
  if (fallback.has(key)) return fallback.get(key)!;
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function idsFrom(raw: string): Set<string> {
  try {
    const ids: unknown = JSON.parse(raw);
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(EVENT, notify);
  };
}

/** First-view receipts contain only bloom IDs, scoped to this account/browser. */
export function useSeenTending(tenantId: string, source: Tending = EMPTY_TENDING) {
  const key = `slow-garden:seen-blooms:${tenantId}`;
  const read = useCallback(() => snapshot(key), [key]);
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  const tending = useMemo(() => {
    const seen = idsFrom(raw);
    if (!seen.size) return source;
    return {
      ...source,
      blooms: source.blooms.map((b) => seen.has(b.id) ? { ...b, isNew: false } : b),
    };
  }, [source, raw]);
  const markBloomsSeen = useCallback((ids: string[]) => {
    const seen = idsFrom(snapshot(key));
    const added = ids.filter((id) => !seen.has(id));
    if (!added.length) return;
    for (const id of added) seen.add(id);
    const next = JSON.stringify([...seen]);
    try {
      window.localStorage.setItem(key, next);
      fallback.delete(key);
    } catch {
      // Storage restrictions must not repeatedly re-announce a viewed bloom.
      fallback.set(key, next);
    }
    window.dispatchEvent(new Event(EVENT));
  }, [key]);
  return { tending, markBloomsSeen };
}
