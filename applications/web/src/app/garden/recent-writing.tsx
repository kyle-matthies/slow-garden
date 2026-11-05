"use client";

import type { GardenData } from "@/lib/garden/types";
import { recentWriting } from "@/lib/garden/recent-writing";
import { EntryTime } from "./entry-time";
import "./recent-writing.css";

/** A quiet, optional route back to saved writing. No reminders or note excerpts. */
export function RecentWriting({
  data,
  plotId = "",
  onNavigate,
}: {
  data: GardenData;
  plotId?: string;
  onNavigate: (topicId: string, thoughtId: string, entryId: string) => void;
}) {
  const items = recentWriting(data, plotId);
  if (!items.length) return null;

  return (
    <details className="recent-writing">
      <summary>
        <span>Continue writing</span>
        <span className="recent-writing-count">{items.length} recent {items.length === 1 ? "thought" : "thoughts"}</span>
      </summary>
      <p className="recent-writing-intro">Open where you last saved{plotId ? " in this topic" : " in this garden"}.</p>
      <ul aria-label="Recent saved thoughts">
        {items.map((item) => (
          <li key={item.thoughtId}>
            <button
              type="button"
              onClick={() => onNavigate(item.topicId, item.thoughtId, item.entryId)}
            >
              <strong>{item.thoughtTitle}</strong>
              <span className="recent-writing-topic">{item.topicName}</span>
              <span className="recent-writing-time">{item.edited ? "Edited" : "Written"} <EntryTime value={item.activityAt} /></span>
              <span className="recent-writing-open">Open saved entry <span aria-hidden="true">↗</span></span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
