import { describe, expect, it } from "vitest";
import type { GardenData } from "@/lib/garden/types";
import { pickWritingThought } from "./level-nav";

const seed = (id: string, plot_id: string, status = "active") =>
  ({ id, plot_id, garden_id: "g", title: id, status }) as GardenData["seeds"][number];
const entry = (seed_id: string, created_at: string, archived_at: string | null = null) =>
  ({ entry_id: `${seed_id}-${created_at}`, seed_id, created_at, archived_at }) as GardenData["entries"][number];

function garden(overrides: Partial<GardenData> = {}): GardenData {
  return {
    tenantId: "t",
    gardenId: "g",
    gardens: [{ id: "g", name: "Garden", status: "active" }],
    plots: [
      { id: "p1", garden_id: "g", name: "One", archived_at: null },
      { id: "p2", garden_id: "g", name: "Two", archived_at: null },
      { id: "p3", garden_id: "g", name: "Shut", archived_at: "2026-01-01T00:00:00Z" },
    ],
    seeds: [seed("a", "p1"), seed("b", "p1"), seed("c", "p2"), seed("d", "p3"), seed("e", "p2", "archived")],
    entries: [
      entry("a", "2026-01-01T00:00:00Z"),
      entry("b", "2026-01-03T00:00:00Z"),
      entry("c", "2026-01-05T00:00:00Z"),
      entry("d", "2026-01-09T00:00:00Z"),
      entry("a", "2026-01-08T00:00:00Z", "2026-01-08T01:00:00Z"),
    ],
    ...overrides,
  } as GardenData;
}

describe("pickWritingThought", () => {
  it("keeps the thought that is already open", () => {
    expect(pickWritingThought(garden(), "p1", "a")?.id).toBe("a");
  });
  it("prefers the most recently written thought in the current topic", () => {
    expect(pickWritingThought(garden(), "p1", "")?.id).toBe("b");
  });
  it("falls back to the most recently written thought in the garden", () => {
    expect(pickWritingThought(garden(), "", "")?.id).toBe("c");
  });
  it("never picks an archived thought or one in an archived topic", () => {
    expect(pickWritingThought(garden(), "p3", "d")?.id).toBe("c");
    expect(pickWritingThought(garden(), "p2", "e")?.id).toBe("c");
  });
  it("returns nothing when the garden is archived or has no thoughts", () => {
    expect(
      pickWritingThought(
        garden({ gardens: [{ id: "g", name: "Garden", status: "archived" }] } as Partial<GardenData>),
        "",
        "",
      ),
    ).toBeNull();
    expect(pickWritingThought(garden({ seeds: [] }), "", "")).toBeNull();
  });
});
