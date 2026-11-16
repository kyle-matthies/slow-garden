"use client";

import { useSyncExternalStore } from "react";

const subscribeToClock = () => () => {};

export function EntryTime({
  value,
  format = "full",
}: {
  value: string;
  /** "date" drops the clock time for compact labels. */
  format?: "full" | "date";
}) {
  const hydrated = useSyncExternalStore(
    subscribeToClock,
    () => true,
    () => false,
  );
  return (
    <time dateTime={value}>
      {format === "date"
        ? new Date(value).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            timeZone: hydrated ? undefined : "UTC",
          })
        : new Date(value).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: hydrated ? undefined : "UTC",
        timeZoneName: "short",
      })}
    </time>
  );
}
