import {
  formatDate,
  kindLabel,
  type CabinetBloom,
  type ResolvedClipping,
} from "./returns-cabinet";

/**
 * Text placed in a new entry when the person chooses "Continue this thought".
 * The quoted lines are the person's own words; the attribution line names the AI
 * as the selector so the two stay distinguishable inside plain text.
 */
export function buildContinuation(
  bloom: CabinetBloom,
  clipping: ResolvedClipping,
): string {
  const quoted = clipping.excerpt
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const where = [
    clipping.source.created_at
      ? `your entry of ${formatDate(clipping.source.created_at)}`
      : "your entry",
    clipping.source.revision_number !== null
      ? `revision ${clipping.source.revision_number}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `${quoted}\n> — ${where}. [Clipping chosen by AI · ${kindLabel(bloom.kind)}. The quote above is yours; the choice to surface it is not.]\n\n`;
}

type StoredDraft = {
  body: string;
  entryId: string;
  revisionId: string;
  expectedRevisionId: string | null;
};

/**
 * Seeds the tab-local draft for a new entry in the given thought without ever
 * discarding writing already waiting there. Returns false when storage is unavailable.
 */
export function prefillNewEntryDraft(
  tenantId: string,
  seedId: string,
  text: string,
): boolean {
  const key = `slow-garden:draft:v2:${tenantId}:${seedId}:new`;
  try {
    let existing: StoredDraft | null = null;
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.body === "string" &&
        typeof parsed.entryId === "string" &&
        typeof parsed.revisionId === "string"
      )
        existing = parsed;
    }
    const next: StoredDraft = existing
      ? {
          ...existing,
          body: existing.body.trim()
            ? `${existing.body.replace(/\s+$/, "")}\n\n${text}`
            : text,
          revisionId: crypto.randomUUID(),
        }
      : {
          body: text,
          entryId: crypto.randomUUID(),
          revisionId: crypto.randomUUID(),
          expectedRevisionId: null,
        };
    sessionStorage.setItem(key, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
