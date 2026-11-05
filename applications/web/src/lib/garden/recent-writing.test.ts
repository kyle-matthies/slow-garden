import { describe, expect, it } from "vitest";
import type { Entry, GardenData, Plot, Seed } from "./types";
import { recentWriting } from "./recent-writing";

const plot = (id: string, garden = "g1"): Plot => ({ id, garden_id: garden, name: id, ai_enabled: false, cross_pollinate: false, archived_at: null, permission_version: 1 });
const seed = (id: string, topic = "p1", garden = "g1"): Seed => ({ id, plot_id: topic, garden_id: garden, title: id, status: "active", created_at: "2026-01-01T00:00:00Z" });
const entry = (id: string, thought: string, created: string, revised = created): Entry => ({ entry_id: id, seed_id: thought, revision_id: `r-${id}`, body: "Synthetic text that should not be returned by this helper", revision_number: 1, created_at: created, revised_at: revised, archived_at: null });
function scope(): GardenData {
  return { tenantId: "synthetic", gardenId: "g1", gardens: [{ id: "g1", name: "Garden", status: "active" }], plots: [plot("p1")], seeds: [seed("s1")], entries: [entry("e1", "s1", "2026-11-01T00:00:00Z")], aiAvailable: false };
}

describe("recentWriting", () => {
  it("resumes the most recently edited exact entry and deduplicates thoughts within a three-item cap", () => {
    const data = scope();
    data.seeds.push(seed("s2"), seed("s3"), seed("s4"));
    data.entries = [
      entry("older-edited", "s1", "2026-09-01T00:00:00Z", "2026-11-04T00:00:00Z"),
      entry("newer-written", "s1", "2026-11-01T00:00:00Z"),
      entry("e2", "s2", "2026-11-03T00:00:00Z"),
      entry("e3", "s3", "2026-11-02T00:00:00Z"),
      entry("e4", "s4", "2026-10-31T00:00:00Z"),
    ];
    const before = JSON.stringify(data);
    const result = recentWriting(data);
    expect(result.map((r) => [r.thoughtId, r.entryId])).toEqual([["s1", "older-edited"], ["s2", "e2"], ["s3", "e3"]]);
    expect(result[0]).toMatchObject({ edited: true, activityAt: "2026-11-04T00:00:00.000Z" });
    expect(result[1].edited).toBe(false);
    expect(JSON.stringify(data)).toBe(before);
    expect(JSON.stringify(result)).not.toContain("Synthetic text");
  });

  it("respects the current garden and optional topic, excluding dangling or mismatched parents", () => {
    const data = scope();
    data.gardens.push({ id: "g2", name: "Other", status: "active" });
    data.plots.push(plot("p2"), plot("other-topic", "g2"));
    data.seeds.push(seed("s2", "p2"), seed("other", "other-topic", "g2"), seed("wrong-parent", "other-topic"), seed("missing-parent", "missing"));
    data.entries.push(...["s2", "other", "wrong-parent", "missing-parent", "missing-thought"].map((id) => entry(`e-${id}`, id, "2026-11-04T00:00:00Z")));
    expect(recentWriting(data).map((r) => r.thoughtId)).toEqual(["s2", "s1"]);
    expect(recentWriting(data, "p2").map((r) => r.thoughtId)).toEqual(["s2"]);
    expect(recentWriting(data, "unknown-topic")).toEqual([]);
    expect(recentWriting({ ...data, gardenId: "unknown-garden" })).toEqual([]);
  });

  it.each(["garden", "topic", "thought", "entry"])("excludes archived %s writing", (level) => {
    const data = scope();
    if (level === "garden") data.gardens[0].status = "archived";
    if (level === "topic") data.plots[0].archived_at = "2026-11-02T00:00:00Z";
    if (level === "thought") data.seeds[0].status = "archived";
    if (level === "entry") data.entries[0].archived_at = "2026-11-02T00:00:00Z";
    expect(recentWriting(data)).toEqual([]);
  });

  it("compares actual timestamp instants, handles malformed dates, and settles ties deterministically", () => {
    const data = scope();
    data.seeds.push(seed("s2"), seed("s3"));
    data.entries = [
      entry("e1", "s1", "2026-11-01T00:30:00+14:00"),
      entry("b", "s2", "2026-10-31T12:00:00Z", "invalid"),
      entry("a", "s2", "2026-10-31T12:00:00Z"),
      entry("invalid", "s3", "invalid", "invalid"),
    ];
    expect(recentWriting(data).map((r) => r.entryId)).toEqual(["a", "e1"]);
    expect(recentWriting({ ...data, entries: [...data.entries].reverse() })).toEqual(recentWriting(data));
  });
});
