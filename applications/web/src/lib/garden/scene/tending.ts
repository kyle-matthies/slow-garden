/**
 * The web side of the tending contract (ADR-008). Tending output is derived
 * material: it is always labelled in words, drawn in its own material, and
 * every item points at exact source revisions. Nothing here grows a plant.
 */
export type Evidence = {
  revisionId: string;
  seedId: string;
  excerpt: string;
  /** When the cited revision was written. */
  writtenAt: string;
};

export type TendingMarkKind = "theme" | "open_question" | "unfinished";

export type TendingMark = {
  id: string;
  passId: string;
  seedId: string;
  kind: TendingMarkKind;
  label: string;
  evidence: Evidence[];
  createdAt: string;
  response?: "keep" | "prune";
};

export type BloomKind =
  | "connection"
  | "tension"
  | "change"
  | "question"
  | "pattern"
  | "echo";

export type TendingBloom = {
  id: string;
  passId: string;
  kind: BloomKind;
  interpretation: string;
  evidence: Evidence[];
  createdAt: string;
  /** True until the person has seen it once in the garden. */
  isNew: boolean;
  response?: "keep" | "correct" | "prune";
};

/** Aggregated from kept theme marks in SQL; counts are never model claims. */
export type GardenTheme = {
  label: string;
  seedIds: string[];
  days: number;
  firstAt: string;
  lastAt: string;
};

export type Tending = {
  marks: TendingMark[];
  blooms: TendingBloom[];
  themes: GardenTheme[];
  /** The latest finished tending for this garden, if any. */
  lastTendedAt?: string;
};

export const EMPTY_TENDING: Tending = { marks: [], blooms: [], themes: [] };

export const BLOOM_LABEL: Record<BloomKind, string> = {
  connection: "Possible connection",
  tension: "Tension",
  change: "Change",
  question: "Question from tending",
  pattern: "Noticed",
  echo: "Echo",
};

export const MARK_LABEL: Record<TendingMarkKind, string> = {
  theme: "Tended",
  open_question: "Left open · your words",
  unfinished: "Tended · unfinished",
};

const active = <T extends { response?: string }>(items: readonly T[]) =>
  items.filter((i) => i.response !== "prune");

export function marksForSeed(tending: Tending, seedId: string): TendingMark[] {
  return active(tending.marks).filter((m) => m.seedId === seedId);
}

export function bloomSeeds(bloom: TendingBloom): string[] {
  return [...new Set(bloom.evidence.map((e) => e.seedId))];
}

export function bloomsForSeed(
  tending: Tending,
  seedId: string,
): TendingBloom[] {
  return active(tending.blooms).filter((b) => bloomSeeds(b).includes(seedId));
}

/** Pairs of plants that a bloom or recurring theme draws a thread between. */
export type Thread = {
  id: string;
  from: string;
  to: string;
  kind: BloomKind | "theme";
  label: string;
};

export function threadsFor(
  tending: Tending,
  visible: ReadonlySet<string>,
): Thread[] {
  const threads: Thread[] = [];
  for (const bloom of active(tending.blooms)) {
    const seeds = bloomSeeds(bloom).filter((s) => visible.has(s));
    for (let i = 1; i < seeds.length; i++)
      threads.push({
        id: `${bloom.id}:${i}`,
        from: seeds[i - 1],
        to: seeds[i],
        kind: bloom.kind,
        label: BLOOM_LABEL[bloom.kind],
      });
  }
  for (const theme of tending.themes) {
    const seeds = theme.seedIds.filter((s) => visible.has(s));
    for (let i = 1; i < seeds.length; i++)
      threads.push({
        id: `theme:${theme.label}:${i}`,
        from: seeds[i - 1],
        to: seeds[i],
        kind: "theme",
        label: `Noticed · ${theme.label}`,
      });
  }
  return threads;
}

/** Whole months between the oldest and newest evidence, for echo cues. */
export function monthsApart(evidence: readonly Evidence[]): number {
  if (evidence.length < 2) return 0;
  const times = evidence
    .map((e) => Date.parse(e.writtenAt))
    .sort((a, b) => a - b);
  return Math.floor((times[times.length - 1] - times[0]) / (30.44 * 86400000));
}

export function themeSentence(theme: GardenTheme): string {
  const month = new Date(theme.firstAt).toLocaleString("en", {
    month: "long",
    timeZone: "UTC",
  });
  return `Noticed · returned to ${theme.label} on ${theme.days} days since ${month}`;
}

export function bloomHeadline(bloom: TendingBloom): string {
  if (bloom.kind === "echo") {
    const months = monthsApart(bloom.evidence);
    return months > 0
      ? `Echo · ${months} ${months === 1 ? "month" : "months"} apart`
      : "Echo";
  }
  return BLOOM_LABEL[bloom.kind];
}
