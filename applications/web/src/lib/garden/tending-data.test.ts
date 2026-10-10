import { describe, expect, it } from "vitest";
import type { Entry } from "./types";
import { EMPTY_TENDING } from "./scene/tending";
import { loadTending, toEvidence } from "./tending-data";

type Result = { data: unknown; error: unknown };

/** A chainable stand-in for the Supabase query builder, resolving per table. */
function fakeDb(tables: Record<string, Result>) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "limit"]) builder[m] = () => builder;
      builder.then = (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve);
      return builder;
    },
  } as never;
}

const entry = (id: string, seed: string, at: string) =>
  ({ id, seed_id: seed, revision_id: `r-${id}`, created_at: at }) as unknown as Entry;

const now = Date.parse("2026-10-10T12:00:00Z");

describe("toEvidence", () => {
  it("keeps only evidence it can place on a known revision", () => {
    const revisions = new Map([["r1", { seedId: "s1", writtenAt: "2026-10-01" }]]);
    expect(
      toEvidence(
        [
          { revision_id: "r1", excerpt: "kept" },
          { revision_id: "r9", excerpt: "unknown revision" },
          { revision_id: "r1" },
          "junk",
        ],
        revisions,
      ),
    ).toEqual([{ revisionId: "r1", seedId: "s1", excerpt: "kept", writtenAt: "2026-10-01" }]);
    expect(toEvidence(null, revisions)).toEqual([]);
  });
});

describe("loadTending", () => {
  const entries = [entry("e1", "s1", "2026-10-09T08:00:00Z"), entry("e2", "s2", "2026-06-01T08:00:00Z")];

  it("maps marks, blooms, responses and themes", async () => {
    const db = fakeDb({
      tending_marks: {
        data: [
          {
            id: "m1",
            pass_id: "p1",
            seed_id: "s1",
            kind: "theme",
            label: "rest",
            evidence: [{ revision_id: "r-e1", excerpt: "rest" }],
            created_at: "2026-10-10T02:10:00Z",
          },
        ],
        error: null,
      },
      tending_mark_responses: {
        data: [
          { mark_id: "m1", response: "prune", created_at: "2026-10-10T09:00:00Z" },
          { mark_id: "m1", response: "keep", created_at: "2026-10-10T08:00:00Z" },
        ],
        error: null,
      },
      blooms: {
        data: [
          {
            id: "b1",
            pass_id: "p1",
            kind: "echo",
            interpretation: "An older thought sits beside this one.",
            evidence: [
              { revision_id: "r-e1", excerpt: "now" },
              { revision_id: "r-old", excerpt: "then" },
            ],
            created_at: "2026-10-10T02:10:00Z",
          },
          {
            id: "b2",
            pass_id: "p1",
            kind: "connection",
            interpretation: "Cites nothing we can place.",
            evidence: [{ revision_id: "r-gone", excerpt: "x" }],
            created_at: "2026-10-10T02:10:00Z",
          },
        ],
        error: null,
      },
      seed_revisions: {
        data: [{ id: "r-old", seed_id: "s2", created_at: "2026-05-30T08:00:00Z" }],
        error: null,
      },
      garden_themes: {
        data: [
          { label: "rest", seed_ids: ["s1", "s2"], days: 4, first_at: "2026-05-30", last_at: "2026-10-09" },
          { label: null, seed_ids: null, days: null, first_at: null, last_at: null },
        ],
        error: null,
      },
    });
    const tending = await loadTending(db, "g1", entries, now);
    expect(tending.marks).toHaveLength(1);
    expect(tending.marks[0]).toMatchObject({ id: "m1", seedId: "s1", response: "prune" });
    expect(tending.blooms.map((b) => b.id)).toEqual(["b1"]);
    expect(tending.blooms[0].evidence.map((e) => e.seedId)).toEqual(["s1", "s2"]);
    expect(tending.blooms[0].isNew).toBe(true);
    expect(tending.themes).toEqual([
      { label: "rest", seedIds: ["s1", "s2"], days: 4, firstAt: "2026-05-30", lastAt: "2026-10-09" },
    ]);
    expect(tending.lastTendedAt).toBe("2026-10-10T02:10:00Z");
  });

  it("yields no tending when the database cannot provide it", async () => {
    const db = fakeDb({
      tending_marks: { data: null, error: { message: "relation does not exist" } },
    });
    expect(await loadTending(db, "g1", entries, now)).toBe(EMPTY_TENDING);
  });
});
