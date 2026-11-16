import type { ReactNode } from "react";
import type { GardenData } from "@/lib/garden/types";

/**
 * Phone navigation (D-024, mobile first). On a phone the garden's places sit in
 * a bar under the thumb: Meadow, Pages, Write, Returns, More. These glyphs
 * belong to that bar and are hidden where the top bar carries words alone.
 */
const glyphs: Record<string, ReactNode> = {
  // Meadow: the garden's hill with a low sun.
  meadow: (
    <>
      <path d="M2 19c3-7 6.5-10 10-10s7 3 10 10" />
      <path d="M2 19h20" />
      <circle cx="17.5" cy="6" r="2" />
    </>
  ),
  // Pages: a sheet with ruled lines.
  pages: (
    <>
      <path d="M6 3h8.5L19 7.5V21H6Z" />
      <path d="M14.5 3v4.5H19" />
      <path d="M9 12h7M9 15h7M9 18h4.5" />
    </>
  ),
  // Write: a pencil laid across the page.
  write: (
    <>
      <path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5Z" />
      <path d="M14.5 6l3 3" />
    </>
  ),
  // Returns: an open bloom, the same drawing as the Returns level glyph.
  returns: (
    <>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2 18 18M18 6l-2.8 2.8M8.8 15.2 6 18" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
};

export function NavGlyph({
  name,
}: {
  name: "meadow" | "pages" | "write" | "returns" | "more";
}) {
  return (
    <span className="nav-glyph" data-glyph={name} aria-hidden="true">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {glyphs[name]}
      </svg>
    </span>
  );
}

/**
 * Where "Write" goes: the thought already open, otherwise the thought most
 * recently written in the current topic, otherwise in the whole garden. Null
 * when nothing can be written to yet (no thought, or the garden is archived).
 */
export function pickWritingThought(
  data: GardenData,
  topicId: string,
  thoughtId: string,
) {
  const garden = data.gardens.find((g) => g.id === data.gardenId);
  if (!garden || garden.status !== "active") return null;
  const openTopics = new Set(
    data.plots.filter((p) => !p.archived_at).map((p) => p.id),
  );
  const writable = data.seeds.filter(
    (s) => s.status === "active" && openTopics.has(s.plot_id),
  );
  const open = writable.find((s) => s.id === thoughtId);
  if (open) return open;
  const latest = new Map<string, string>();
  for (const e of data.entries) {
    if (e.archived_at) continue;
    if ((latest.get(e.seed_id) ?? "") < e.created_at)
      latest.set(e.seed_id, e.created_at);
  }
  const newest = (seeds: typeof writable) =>
    [...seeds].sort(
      (a, b) =>
        (latest.get(b.id) ?? "").localeCompare(latest.get(a.id) ?? "") ||
        a.id.localeCompare(b.id),
    )[0];
  const inTopic = writable.filter((s) => s.plot_id === topicId);
  return newest(inTopic.length ? inTopic : writable) ?? null;
}

/**
 * Put the caret on the blank page. When that page is already on screen it is
 * focused inside the tap, which is what lets a phone raise its keyboard. When
 * the same tap navigates to another thought, the new page is awaited briefly.
 */
export function focusWritingPage(): void {
  const find = () =>
    document.querySelector<HTMLTextAreaElement>(
      ".specimen-pages > .writing-form textarea",
    );
  const focus = (textarea: HTMLTextAreaElement) => {
    textarea.focus({ preventScroll: true });
    textarea.closest(".writing-form")?.scrollIntoView({ block: "start" });
  };
  const before = find();
  if (before && !before.disabled) focus(before);
  let tries = 0;
  const follow = () => {
    const page = find();
    if (page && !page.disabled && page !== before) return focus(page);
    // Still the page that was already open: nothing further to wait for.
    if (page && page === before && tries >= 6) {
      if (!page.disabled && document.activeElement !== page) focus(page);
      return;
    }
    if (++tries < 40) window.setTimeout(follow, 50);
  };
  window.setTimeout(follow, 50);
}
