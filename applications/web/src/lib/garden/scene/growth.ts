/**
 * Growth reflects the person's own stewardship of a thought: how many dated
 * entries it holds, how often they were revised, and on how many distinct days
 * the person returned. Archived entries still count, because the work happened.
 *
 * Growth is monotonic in time. Nothing decays, wilts or shrinks when a thought
 * rests, and AI output never contributes. It is not a score and is never shown
 * as one.
 */
export type GrowthStage =
  | "seed"
  | "sprout"
  | "leafing"
  | "budding"
  | "flowering";

export const GROWTH_STAGES: readonly GrowthStage[] = [
  "seed",
  "sprout",
  "leafing",
  "budding",
  "flowering",
];

export type GrowthEntry = {
  created_at: string;
  revised_at: string;
  revision_number: number;
};

export type Growth = {
  stage: GrowthStage;
  /** 0..1 progress within the stage; shapes size and bud/flower count. */
  vigor: number;
  entries: number;
  /** Entries plus later revisions. */
  contributions: number;
  /** Distinct UTC calendar days with an entry or a revision. */
  days: number;
  lastWrittenAt: string | null;
};

const day = (iso: string) => iso.slice(0, 10);

export function growthFor(entries: readonly GrowthEntry[]): Growth {
  const days = new Set<string>();
  let contributions = 0;
  let lastWrittenAt: string | null = null;
  for (const e of entries) {
    contributions += Math.max(1, e.revision_number);
    days.add(day(e.created_at));
    if (e.revised_at && e.revised_at > e.created_at)
      days.add(day(e.revised_at));
    const latest = e.revised_at > e.created_at ? e.revised_at : e.created_at;
    if (!lastWrittenAt || latest > lastWrittenAt) lastWrittenAt = latest;
  }
  const n = entries.length;
  const d = days.size;
  let stage: GrowthStage;
  let vigor: number;
  if (n === 0) {
    stage = "seed";
    vigor = 0;
  } else if ((n >= 5 && d >= 3) || contributions >= 8) {
    stage = "flowering";
    vigor = Math.min(1, (contributions - 5) / 15);
  } else if ((n >= 3 && d >= 2) || contributions >= 5) {
    stage = "budding";
    vigor = Math.min(1, (contributions - 3) / 5);
  } else if (n >= 2 || contributions >= 2 || d >= 2) {
    stage = "leafing";
    vigor = Math.min(1, (contributions - 2) / 3);
  } else {
    stage = "sprout";
    vigor = 0;
  }
  return {
    stage,
    vigor: Math.max(0, vigor),
    entries: n,
    contributions,
    days: d,
    lastWrittenAt,
  };
}

/** Plain-language description for accessible names; never a score. */
export function describeGrowth(g: Growth): string {
  if (g.entries === 0) return "no entries yet";
  const entries = `${g.entries} ${g.entries === 1 ? "entry" : "entries"}`;
  return g.days > 1 ? `${entries} over ${g.days} days` : entries;
}
