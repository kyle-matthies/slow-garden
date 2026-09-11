import { describe, expect, it } from "vitest";
import type { Tables } from "@/types/database";
import {
  exportHeaders,
  formatSourceExport,
  type SourceExport,
} from "./export-format";

const exportedAt = "2026-09-10T05:32:00.000Z";
const garden = {
  id: "garden-1",
  name: "Watering Plans",
} as Tables<"gardens">;
const plot = {
  id: "plot-1",
  garden_id: garden.id,
  name: "Morning Routine",
} as Tables<"plots">;
const excludedPlot = {
  id: "plot-2",
  garden_id: "garden-2",
  name: "Excluded Plot",
} as Tables<"plots">;
const seed = {
  id: "seed-1",
  plot_id: plot.id,
  title: "Watering schedule",
} as Tables<"seeds">;
const excludedSeed = {
  id: "seed-2",
  plot_id: excludedPlot.id,
  title: "Excluded thought",
} as Tables<"seeds">;
const entry = {
  id: "entry-1",
  seed_id: seed.id,
  created_at: "2026-09-09T08:00:00.000Z",
} as Tables<"entries">;
const entryWithoutRevisions = {
  id: "entry-2",
  seed_id: seed.id,
  created_at: "2026-09-10T08:00:00.000Z",
} as Tables<"entries">;
const excludedEntry = {
  id: "entry-excluded",
  seed_id: excludedSeed.id,
  created_at: "2026-09-10T09:00:00.000Z",
} as Tables<"entries">;
const revisionOne = {
  entry_id: entry.id,
  revision_number: 1,
  created_at: "2026-09-09T08:01:00.000Z",
  body: "Synthetic entry about watering schedule",
} as Tables<"seed_revisions">;
const revisionTwo = {
  entry_id: entry.id,
  revision_number: 2,
  created_at: "2026-09-10T05:30:00.000Z",
  body: "Synthetic revision about adjusting the schedule",
} as Tables<"seed_revisions">;

const snapshot: SourceExport = {
  exported_at: exportedAt,
  gardens: [garden],
  plots: [plot, excludedPlot],
  seeds: [seed, excludedSeed],
  entries: [entry, entryWithoutRevisions, excludedEntry],
  revisions: [revisionOne, revisionTwo],
};

describe("formatSourceExport", () => {
  it("formats the garden hierarchy and revisions as markdown", () => {
    const markdown = formatSourceExport(snapshot, "md");

    expect(markdown.startsWith("# Slow Garden — source export")).toBe(true);
    expect(markdown).toContain("## Watering Plans");
    expect(markdown).toContain("### Morning Routine");
    expect(markdown).toContain("#### Watering schedule");
    expect(markdown).toContain(
      "##### Entry entry-1 · 2026-09-09T08:00:00.000Z",
    );
    expect(markdown).toContain("Revision 2 · 2026-09-10T05:30:00.000Z");
    expect(markdown).toContain(
      "Synthetic revision about adjusting the schedule",
    );
    expect(markdown).toContain(
      "##### Entry entry-2 · 2026-09-10T08:00:00.000Z",
    );
    expect(markdown).not.toContain("Excluded Plot");
    expect(markdown).not.toContain("Excluded thought");
  });

  it("formats the ordered JSON export and download headers", () => {
    const parsed = JSON.parse(formatSourceExport(snapshot, "json")) as {
      schema: string;
      exported_at: string;
      [key: string]: unknown;
    };
    expect(parsed.schema).toBe("slow-garden-source-v2");
    expect(parsed.exported_at).toBe(exportedAt);
    expect(Object.keys(parsed)).toEqual([
      "schema",
      "exported_at",
      "gardens",
      "plots",
      "seeds",
      "entries",
      "revisions",
    ]);

    const markdownHeaders = exportHeaders("md");
    expect(markdownHeaders["Content-Type"]).toBe("text/markdown; charset=utf-8");
    expect(markdownHeaders["Content-Disposition"]).toContain(
      'filename="slow-garden-sources.md"',
    );
    expect(markdownHeaders["Cache-Control"]).toBe("private, no-store");
    expect(markdownHeaders["X-Content-Type-Options"]).toBe("nosniff");

    const jsonHeaders = exportHeaders("json");
    expect(jsonHeaders["Content-Type"]).toBe("application/json");
    expect(jsonHeaders["Content-Disposition"]).toContain(
      'filename="slow-garden-sources.json"',
    );
    expect(jsonHeaders["Cache-Control"]).toBe("private, no-store");
    expect(jsonHeaders["X-Content-Type-Options"]).toBe("nosniff");
  });
});
