import type { Entry, Plot, Seed } from "./types";

// Bounded search and chronology helpers. Pure functions, no I/O, no ranking
// signals beyond the words a person typed and when they wrote.

export const MIN_QUERY_LENGTH = 2;
export const DEFAULT_RESULT_LIMIT = 30;
export const EXCERPT_RADIUS = 70;

export type ExcerptSegment = { text: string; highlight: boolean };

export type SearchHit = {
  kind: "title" | "entry";
  seed: Seed;
  entry: Entry | null;
  archived: boolean;
  score: number;
  /** ISO timestamp used for recency ordering among equal scores. */
  at: string;
  excerpt: ExcerptSegment[];
};

export type SearchScope = {
  seeds: Seed[];
  entries: Entry[];
  plots: Plot[];
  gardenArchived?: boolean;
  /** Restrict to one topic; empty means the whole garden. */
  plotId?: string;
  includeArchived?: boolean;
  limit?: number;
};

export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function tokenize(query: string): string[] {
  const seen = new Set<string>();
  for (const term of normalize(query).split(/[^\p{L}\p{N}]+/u)) {
    if (term) seen.add(term);
  }
  return [...seen];
}

export function isArchivedSeed(
  seed: Seed,
  plots: Plot[],
  gardenArchived = false,
) {
  return (
    gardenArchived ||
    seed.status === "archived" ||
    !!plots.find((p) => p.id === seed.plot_id)?.archived_at
  );
}

export function isArchivedEntry(
  entry: Entry,
  seed: Seed,
  plots: Plot[],
  gardenArchived = false,
) {
  return !!entry.archived_at || isArchivedSeed(seed, plots, gardenArchived);
}

type Match = { start: number; end: number };

/** Every occurrence of every term, in `normalize(text)` coordinates. */
function findMatches(normalizedText: string, terms: string[]): Match[] {
  const matches: Match[] = [];
  for (const term of terms) {
    let from = 0;
    while (from <= normalizedText.length) {
      const at = normalizedText.indexOf(term, from);
      if (at === -1) break;
      matches.push({ start: at, end: at + term.length });
      from = at + Math.max(term.length, 1);
    }
  }
  return matches.sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Builds a bounded excerpt around the first match, highlighting every term
 * inside the window. Returns the (possibly truncated) plain text when nothing
 * matches so callers can always render something.
 */
export function excerpt(
  text: string,
  terms: string[],
  radius = EXCERPT_RADIUS,
): ExcerptSegment[] {
  const flat = text.replace(/\s+/g, " ").trim();
  // Excerpt offsets must line up with the original string, so only use the
  // accent-stripped form when it keeps the same length.
  const normalized = normalize(flat);
  const lower =
    normalized.length === flat.length ? normalized : flat.toLowerCase();
  const matches = findMatches(
    lower,
    terms.map((t) => normalize(t)),
  );
  if (matches.length === 0) {
    const cut = flat.slice(0, radius * 2);
    return [
      { text: cut + (flat.length > cut.length ? "…" : ""), highlight: false },
    ];
  }
  const first = matches[0];
  let start = Math.max(0, first.start - radius);
  let end = Math.min(flat.length, first.end + radius);
  if (start > 0) {
    const space = flat.lastIndexOf(" ", start);
    if (space >= 0 && start - space < 20) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.indexOf(" ", end);
    if (space >= 0 && space - end < 20) end = space;
  }
  const segments: ExcerptSegment[] = [];
  if (start > 0) segments.push({ text: "…", highlight: false });
  let cursor = start;
  for (const m of matches) {
    if (m.end <= cursor || m.start >= end) continue;
    const s = Math.max(m.start, cursor),
      e = Math.min(m.end, end);
    if (s > cursor)
      segments.push({ text: flat.slice(cursor, s), highlight: false });
    segments.push({ text: flat.slice(s, e), highlight: true });
    cursor = e;
  }
  if (cursor < end)
    segments.push({ text: flat.slice(cursor, end), highlight: false });
  if (end < flat.length) segments.push({ text: "…", highlight: false });
  return segments;
}

function score(
  title: string,
  body: string,
  terms: string[],
  phrase: string,
): number {
  const t = normalize(title),
    b = normalize(body);
  let total = 0;
  for (const term of terms) {
    const inTitle = t.includes(term),
      inBody = b.includes(term);
    if (!inTitle && !inBody) return 0;
    total += inTitle ? 3 : 1;
  }
  if (terms.length > 1) {
    if (t.includes(phrase)) total += 4;
    else if (b.includes(phrase)) total += 2;
  }
  return total;
}

/**
 * Ranks thoughts and entries whose title or body contain every query term.
 * Title matches outrank body matches; an intact phrase outranks scattered
 * terms; ties resolve by most recent writing. Results are capped at `limit`.
 */
export function searchGarden(query: string, scope: SearchScope): SearchHit[] {
  const terms = tokenize(query);
  const phrase = normalize(query).trim().replace(/\s+/g, " ");
  if (terms.length === 0 || phrase.length < MIN_QUERY_LENGTH) return [];
  const limit = scope.limit ?? DEFAULT_RESULT_LIMIT;
  const gardenArchived = scope.gardenArchived ?? false;
  const hits: SearchHit[] = [];
  const seeds = scope.seeds.filter(
    (s) => !scope.plotId || s.plot_id === scope.plotId,
  );
  for (const seed of seeds) {
    const seedArchived = isArchivedSeed(seed, scope.plots, gardenArchived);
    if (seedArchived && !scope.includeArchived) continue;
    const titleScore = score(seed.title, "", terms, phrase);
    if (titleScore > 0)
      hits.push({
        kind: "title",
        seed,
        entry: null,
        archived: seedArchived,
        score: titleScore,
        at: seed.created_at,
        excerpt: excerpt(seed.title, terms),
      });
    for (const entry of scope.entries) {
      if (entry.seed_id !== seed.id) continue;
      const archived = seedArchived || !!entry.archived_at;
      if (archived && !scope.includeArchived) continue;
      const s = score("", entry.body, terms, phrase);
      if (s === 0) continue;
      hits.push({
        kind: "entry",
        seed,
        entry,
        archived,
        score: s,
        at: entry.created_at,
        excerpt: excerpt(entry.body, terms),
      });
    }
  }
  return hits
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.at.localeCompare(a.at) ||
        (a.entry?.entry_id ?? a.seed.id).localeCompare(
          b.entry?.entry_id ?? b.seed.id,
        ),
    )
    .slice(0, limit);
}

export type DayGroup = {
  /** Calendar day key in the chosen time zone, `YYYY-MM-DD`. */
  day: string;
  entries: Entry[];
};

export function dayKey(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Groups entries by calendar day, newest day first, newest entry first. */
export function groupEntriesByDay(
  entries: Entry[],
  timeZone?: string,
): DayGroup[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of [...entries].sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) ||
      b.entry_id.localeCompare(a.entry_id),
  )) {
    const key = dayKey(entry.created_at, timeZone);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({ day, entries: list }));
}

/** Entries visible in the timeline for a garden or one topic. */
export function timelineEntries(scope: SearchScope): Entry[] {
  const gardenArchived = scope.gardenArchived ?? false;
  const seeds = new Map(
    scope.seeds
      .filter((s) => !scope.plotId || s.plot_id === scope.plotId)
      .map((s) => [s.id, s] as const),
  );
  return scope.entries.filter((e) => {
    const seed = seeds.get(e.seed_id);
    if (!seed) return false;
    return (
      scope.includeArchived ||
      !isArchivedEntry(e, seed, scope.plots, gardenArchived)
    );
  });
}
