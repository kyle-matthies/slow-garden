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
