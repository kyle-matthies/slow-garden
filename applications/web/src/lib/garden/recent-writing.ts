import type { GardenData } from "./types";

export const RECENT_WRITING_LIMIT = 3;

export type RecentWritingItem = {
  topicId: string;
  topicName: string;
  thoughtId: string;
  thoughtTitle: string;
  entryId: string;
  activityAt: string;
  edited: boolean;
};

type WritingScope = Pick<GardenData, "gardenId" | "gardens" | "plots" | "seeds" | "entries">;

/**
 * Choose one exact saved entry per active thought, within the loaded garden.
 * Edits count as writing activity. No text, engagement signals or browser state
 * are used, and the source arrays are never sorted or changed in place.
 */
export function recentWriting(data: WritingScope, plotId = ""): RecentWritingItem[] {
  const garden = data.gardens.find((g) => g.id === data.gardenId);
  if (!garden || garden.status !== "active") return [];

  const plots = new Map(data.plots
    .filter((p) => p.garden_id === garden.id && !p.archived_at && (!plotId || p.id === plotId))
    .map((p) => [p.id, p]));
  const thoughts = new Map(data.seeds
    .filter((s) => s.garden_id === garden.id && s.status === "active" && plots.has(s.plot_id))
    .map((s) => [s.id, s]));
  const latest = new Map<string, { item: RecentWritingItem; time: number }>();

  for (const entry of data.entries) {
    const thought = thoughts.get(entry.seed_id);
    if (!thought || entry.archived_at) continue;
    const created = Date.parse(entry.created_at);
    const revised = Date.parse(entry.revised_at);
    const time = Math.max(Number.isFinite(created) ? created : -Infinity, Number.isFinite(revised) ? revised : -Infinity);
    if (!Number.isFinite(time)) continue;
    const previous = latest.get(thought.id);
    // Stable entry IDs settle identical timestamps without relying on input order.
    if (previous && (previous.time > time || (previous.time === time && previous.item.entryId.localeCompare(entry.entry_id) <= 0))) continue;
    const plot = plots.get(thought.plot_id)!;
    latest.set(thought.id, { time, item: {
      topicId: plot.id,
      topicName: plot.name,
      thoughtId: thought.id,
      thoughtTitle: thought.title,
      entryId: entry.entry_id,
      activityAt: new Date(time).toISOString(),
      edited: Number.isFinite(revised) && (!Number.isFinite(created) || revised > created),
    } });
  }

  return [...latest.values()]
    .sort((a, b) => b.time - a.time || a.item.thoughtId.localeCompare(b.item.thoughtId))
    .slice(0, RECENT_WRITING_LIMIT)
    .map(({ item }) => item);
}
