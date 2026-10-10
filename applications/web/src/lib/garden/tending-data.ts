import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { Entry } from "./types";
import { EMPTY_TENDING, type BloomKind, type Evidence, type Tending, type TendingMarkKind } from "./scene/tending";

type Db = SupabaseClient<Database>;
type RevisionInfo = { seedId: string; writtenAt: string };
type RawEvidence = { revision_id?: unknown; excerpt?: unknown };

const NEW_FOR_DAYS = 7;

/** Map stored evidence to the web contract, dropping anything we cannot place. */
export function toEvidence(raw: unknown, revisions: Map<string, RevisionInfo>): Evidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: RawEvidence) => {
    const id = typeof item?.revision_id === "string" ? item.revision_id : "";
    const info = revisions.get(id);
    return info && typeof item.excerpt === "string"
      ? [{ revisionId: id, seedId: info.seedId, excerpt: item.excerpt, writtenAt: info.writtenAt }]
      : [];
  });
}

/** Latest response per id, from rows sorted newest first. */
function latest<T extends { created_at: string }>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T>();
  for (const row of rows) if (!map.has(key(row))) map.set(key(row), row);
  return map;
}

/**
 * Tending for one garden, read under RLS (only completed passes are visible).
 * Any failure, such as a database without the tending migration, yields no
 * tending: the garden itself never depends on it.
 */
export async function loadTending(
  db: Db,
  gardenId: string,
  entries: readonly Entry[],
  now = Date.now(),
): Promise<Tending> {
  try {
    const [marks, markResponses, blooms, bloomResponses, themes] = await Promise.all([
      db
        .from("tending_marks")
        .select("id,pass_id,seed_id,kind,label,evidence,created_at")
        .eq("garden_id", gardenId)
        .order("created_at", { ascending: false })
        .limit(500),
      db
        .from("tending_mark_responses")
        .select("mark_id,response,created_at,tending_marks!inner(garden_id)")
        .eq("tending_marks.garden_id", gardenId)
        .order("created_at", { ascending: false })
        .limit(2000),
      db
        .from("blooms")
        .select("id,pass_id,kind,interpretation,evidence,created_at")
        .eq("garden_id", gardenId)
        .order("created_at", { ascending: false })
        .limit(150),
      db
        .from("bloom_responses")
        .select("bloom_id,response,created_at,blooms!inner(garden_id)")
        .eq("blooms.garden_id", gardenId)
        .order("created_at", { ascending: false })
        .limit(2000),
      db.from("garden_themes").select("label,seed_ids,days,first_at,last_at").eq("garden_id", gardenId),
    ]);
    for (const result of [marks, markResponses, blooms, bloomResponses, themes]) if (result.error) throw result.error;

    const revisions = new Map<string, RevisionInfo>(
      entries.map((e) => [e.revision_id, { seedId: e.seed_id, writtenAt: e.created_at }]),
    );
    // Evidence may cite an earlier revision of an entry; look those up too.
    const cited = new Set<string>();
    for (const row of [...(marks.data ?? []), ...(blooms.data ?? [])])
      for (const e of Array.isArray(row.evidence) ? (row.evidence as RawEvidence[]) : [])
        if (typeof e?.revision_id === "string" && !revisions.has(e.revision_id)) cited.add(e.revision_id);
    const missing = [...cited];
    for (let i = 0; i < missing.length; i += 100) {
      const { data, error } = await db
        .from("seed_revisions")
        .select("id,seed_id,created_at")
        .in("id", missing.slice(i, i + 100));
      if (error) throw error;
      for (const r of data ?? []) revisions.set(r.id, { seedId: r.seed_id, writtenAt: r.created_at });
    }

    const markResponse = latest(markResponses.data ?? [], (r) => r.mark_id);
    const bloomResponse = latest(bloomResponses.data ?? [], (r) => r.bloom_id);
    const tending: Tending = {
      marks: (marks.data ?? []).map((m) => ({
        id: m.id,
        passId: m.pass_id,
        seedId: m.seed_id,
        kind: m.kind as TendingMarkKind,
        label: m.label,
        evidence: toEvidence(m.evidence, revisions),
        createdAt: m.created_at,
        response: markResponse.get(m.id)?.response as "keep" | "prune" | undefined,
      })),
      blooms: (blooms.data ?? []).flatMap((b) => {
        const evidence = toEvidence(b.evidence, revisions);
        if (!evidence.length) return [];
        const response = bloomResponse.get(b.id)?.response as "keep" | "correct" | "prune" | undefined;
        return [
          {
            id: b.id,
            passId: b.pass_id,
            kind: b.kind as BloomKind,
            interpretation: b.interpretation,
            evidence,
            createdAt: b.created_at,
            isNew: !response && now - Date.parse(b.created_at) < NEW_FOR_DAYS * 86_400_000,
            response,
          },
        ];
      }),
      themes: (themes.data ?? []).flatMap((t) =>
        t.label && t.first_at && t.last_at
          ? [
              {
                label: t.label,
                seedIds: t.seed_ids ?? [],
                days: t.days ?? 0,
                firstAt: t.first_at,
                lastAt: t.last_at,
              },
            ]
          : [],
      ),
    };
    const times = [...tending.marks, ...tending.blooms].map((x) => x.createdAt).sort();
    tending.lastTendedAt = times[times.length - 1];
    return tending;
  } catch {
    return EMPTY_TENDING;
  }
}
