"use client";
import { useEffect, useState } from "react";
import { deletionEnabled } from "./actions";

let cached: Promise<boolean> | null = null;

/**
 * Whether permanent deletion is switched on for this deployment
 * (GARDEN_DELETION_ENABLED, read on the server). False until known, so
 * nothing about deletion renders while it is off or cannot be confirmed.
 * Asked once per page load, however many delete controls are on the page.
 */
export function useDeletionEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let current = true;
    if (!cached) {
      try {
        cached = Promise.resolve(deletionEnabled()).then(
          (value) => value === true,
          () => false,
        );
      } catch {
        cached = Promise.resolve(false);
      }
    }
    cached.then((value) => {
      if (current) setEnabled(value);
    });
    return () => {
      current = false;
    };
  }, []);
  return enabled;
}

export function resetDeletionFlagForTests(): void {
  cached = null;
}
