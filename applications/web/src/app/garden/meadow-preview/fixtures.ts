import type { Entry, GardenData, Plot, Seed } from "@/lib/garden/types";
import { seededRandom } from "@/lib/garden/scene/hash";
import type { Tending } from "@/lib/garden/scene/tending";

/**
 * Synthetic gardens for the development-only meadow preview. No real writing:
 * every title and sentence below is invented for layout and motion checks.
 */
const TOPICS = [
  "Slow mornings",
  "The studio question",
  "What the garden teaches",
  "Letters never sent",
  "Making things by hand",
  "Rest and attention",
  "Long walks",
  "Small decisions",
];

const THOUGHTS = [
  "Leave room before naming the solution",
  "What changes once this becomes a roadmap?",
  "The form should not interrupt the idea",
  "Why quiet feels productive",
  "Notes on starting again",
  "A slower kind of ambition",
  "Unfinished is a valid state",
  "What I keep circling back to",
  "The shape of a good week",
  "Paper versus screens",
  "Listening before deciding",
  "The cost of being busy",
  "Things worth repeating",
  "Gardening as patience",
  "Where the energy went",
  "Questions for next spring",
];

const LINES = [
  "Wrote this on the train. The idea is still soft around the edges.",
  "I keep wanting to fix it before I understand it.",
  "Maybe the point is to let it sit for a week and see what remains.",
  "Today it felt clearer: fewer steps, more room.",
  "Not sure yet. Leaving this here so I can come back to it.",
  "The same question from a different side: what would make this lighter?",
  "Noticed I was rushing again. Slowed down and the answer was obvious.",
  "Three small things worked. One big thing did not.",
];

const iso = (base: number, days: number, hours = 9) =>
  new Date(base + days * 86400000 + hours * 3600000).toISOString();

export function syntheticGarden(
  topics: number,
  thoughts: number,
  seed = 7,
): GardenData {
  const random = seededRandom(seed);
  const gardenId = `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
  const base = Date.parse("2026-03-01T00:00:00Z");
  const plots: Plot[] = Array.from({ length: topics }, (_, i) => ({
    id: `plot-${seed}-${i}`,
    garden_id: gardenId,
    name: TOPICS[i % TOPICS.length],
    ai_enabled: i % 2 === 0,
    cross_pollinate: i % 4 === 0,
    archived_at: null,
    permission_version: 1,
  }));
  const seeds: Seed[] = [];
  const entries: Entry[] = [];
  for (let i = 0; i < thoughts; i++) {
    const plot = plots[i % Math.max(1, topics)];
    if (!plot) break;
    const created = Math.floor(random() * 180);
    const id = `seed-${seed}-${i}`;
    seeds.push({
      id,
      garden_id: gardenId,
      plot_id: plot.id,
      title:
        THOUGHTS[i % THOUGHTS.length] +
        (i >= THOUGHTS.length
          ? ` (${Math.floor(i / THOUGHTS.length) + 1})`
          : ""),
      status: "active",
      created_at: iso(base, created),
    });
    // A spread of maturity: some just planted, some tended for months.
    const roll = random();
    const count =
      roll < 0.12
        ? 0
        : roll < 0.3
          ? 1
          : roll < 0.5
            ? 2 + Math.floor(random() * 2)
            : roll < 0.75
              ? 4 + Math.floor(random() * 3)
              : 6 + Math.floor(random() * 8);
    let day = created;
    for (let j = 0; j < count; j++) {
      day += Math.floor(random() * 9);
      const revised = random() < 0.2;
      entries.push({
        entry_id: `entry-${seed}-${i}-${j}`,
        revision_id: `rev-${seed}-${i}-${j}`,
        seed_id: id,
        body: LINES[Math.floor(random() * LINES.length)],
        revision_number: revised ? 2 : 1,
        created_at: iso(base, day, 8 + j),
        revised_at: iso(base, revised ? day + 1 : day, 8 + j),
        archived_at: null,
      });
    }
  }
  return {
    tenantId: "00000000-0000-4000-8000-000000000001",
    gardens: [{ id: gardenId, name: "Preview garden", status: "active" }],
    gardenId,
    plots,
    seeds,
    entries,
    aiAvailable: false,
  };
}

/** Tending fixtures shaped like ADR-008 output, citing the synthetic entries. */
export function syntheticTending(
  data: GardenData,
  kinds: "catalog" | "full",
): Tending {
  const bySeed = (id: string) => data.entries.filter((e) => e.seed_id === id);
  const written = data.seeds.filter((s) => bySeed(s.id).length > 0);
  const evidence = (seedId: string, n = 0) => {
    const e = bySeed(seedId)[n] ?? bySeed(seedId)[0];
    return {
      revisionId: e.revision_id,
      seedId,
      excerpt: e.body.split(".")[0],
      writtenAt: e.created_at,
    };
  };
  const marks = written.slice(0, 6).map((s, i) => ({
    id: `mark-${i}`,
    passId: "pass-1",
    seedId: s.id,
    kind: (
      [
        "theme",
        "open_question",
        "theme",
        "unfinished",
        "theme",
        "theme",
      ] as const
    )[i],
    label: ["slowness", "", "starting again", "", "attention", "slowness"][i],
    evidence: [evidence(s.id)],
    createdAt: "2026-09-30T02:10:00Z",
  }));
  if (kinds === "catalog")
    return {
      marks,
      blooms: [],
      themes: [],
      lastTendedAt: "2026-09-30T02:10:00Z",
    };
  const samePlot = written.filter((s) => s.plot_id === written[0]?.plot_id);
  const blooms = [
    samePlot.length > 1 && {
      id: "bloom-connection",
      passId: "pass-2",
      kind: "connection" as const,
      interpretation: "Both entries return to leaving space before deciding.",
      evidence: [evidence(samePlot[0].id), evidence(samePlot[1].id)],
      createdAt: "2026-10-08T02:20:00Z",
      isNew: true,
    },
    written.length > 3 && {
      id: "bloom-echo",
      passId: "pass-2",
      kind: "echo" as const,
      interpretation:
        "A spring note about rushing sits close to this week's question about lightness.",
      evidence: [evidence(written[3].id), evidence(written[0].id, 1)],
      createdAt: "2026-10-08T02:20:00Z",
      isNew: true,
    },
    written.length > 2 && {
      id: "bloom-question",
      passId: "pass-2",
      kind: "question" as const,
      interpretation:
        "What would you keep if this had to fit in one small step?",
      evidence: [evidence(written[2].id)],
      createdAt: "2026-10-08T02:20:00Z",
      isNew: false,
    },
  ].filter(Boolean) as Tending["blooms"];
  return {
    marks,
    blooms,
    themes:
      samePlot.length > 2
        ? [
            {
              label: "slowness",
              seedIds: samePlot.slice(0, 3).map((s) => s.id),
              days: 4,
              firstAt: "2026-05-02T09:00:00Z",
              lastAt: "2026-10-01T09:00:00Z",
            },
          ]
        : [],
    lastTendedAt: "2026-10-08T02:20:00Z",
  };
}
