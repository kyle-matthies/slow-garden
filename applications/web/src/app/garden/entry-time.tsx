"use client";

import { useSyncExternalStore } from "react";

const subscribeToClock = () => () => {};

export function EntryTime({ value }: { value: string }) {
  const hydrated = useSyncExternalStore(
    subscribeToClock,
    () => true,
    () => false,
  );
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString(undefined, {
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
