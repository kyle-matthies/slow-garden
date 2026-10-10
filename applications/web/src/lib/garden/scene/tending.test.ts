import { describe, expect, it } from "vitest";
import {
  bloomHeadline,
  bloomsForSeed,
  marksForSeed,
  monthsApart,
  themeSentence,
  threadsFor,
  type Tending,
  type TendingBloom,
} from "./tending";

const ev = (seedId: string, writtenAt: string) => ({
  revisionId: `rev-${seedId}-${writtenAt}`,
  seedId,
  excerpt: "words",
  writtenAt,
});

const bloom = (over: Partial<TendingBloom>): TendingBloom => ({
  id: "b",
  passId: "p",
  kind: "connection",
  interpretation: "A short sentence.",
  evidence: [ev("a", "2026-01-01T00:00:00Z"), ev("b", "2026-09-15T00:00:00Z")],
  createdAt: "2026-10-01T00:00:00Z",
  isNew: true,
  ...over,
});

const tending: Tending = {
  marks: [
    { id: "m1", passId: "p", seedId: "a", kind: "theme", label: "slowness", evidence: [], createdAt: "" },
    { id: "m2", passId: "p", seedId: "a", kind: "theme", label: "wrong", evidence: [], createdAt: "", response: "prune" },
  ],
  blooms: [bloom({}), bloom({ id: "pruned", response: "prune" })],
  themes: [{ label: "rest", seedIds: ["a", "b", "c"], days: 4, firstAt: "2026-05-02T00:00:00Z", lastAt: "2026-10-01T00:00:00Z" }],
};

describe("tending contract", () => {
  it("hides pruned marks and blooms", () => {
    expect(marksForSeed(tending, "a").map((m) => m.id)).toEqual(["m1"]);
    expect(bloomsForSeed(tending, "b").map((b) => b.id)).toEqual(["b"]);
  });

  it("draws threads only between visible plants", () => {
    const threads = threadsFor(tending, new Set(["a", "b"]));
    expect(threads.map((t) => [t.from, t.to, t.kind])).toEqual([
      ["a", "b", "connection"],
      ["a", "b", "theme"],
    ]);
    expect(threadsFor(tending, new Set(["a"]))).toEqual([]);
  });

  it("states echo distance and theme recurrence in words from data", () => {
    expect(monthsApart(bloom({}).evidence)).toBe(8);
    expect(bloomHeadline(bloom({ kind: "echo" }))).toBe("Echo · 8 months apart");
    expect(bloomHeadline(bloom({ kind: "question" }))).toBe("Question from tending");
    expect(themeSentence(tending.themes[0])).toBe("Noticed · returned to rest on 4 days since May");
  });
});
