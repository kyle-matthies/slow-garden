"use client";
import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { Entry, GardenData } from "@/lib/garden/types";
import {
  DEFAULT_RESULT_LIMIT,
  MIN_QUERY_LENGTH,
  groupEntriesByDay,
  searchGarden,
  timelineEntries,
  type ExcerptSegment,
} from "@/lib/garden/search";
import "./chronology.css";

export type LensView = "" | "archive" | "timeline";
export type LensNavigate = (
  topic: string,
  thought: string,
  view: LensView,
  entry?: string,
) => void;

const DAYS_PER_PAGE = 30;
const subscribeToClock = () => () => {};
function useHydratedTimeZone() {
  const hydrated = useSyncExternalStore(
    subscribeToClock,
    () => true,
    () => false,
  );
  return hydrated ? undefined : "UTC";
}

/**
 * Roving arrow-key focus for a vertical list of buttons. Arrow keys move
 * between items, Home/End jump, Escape hands focus back to `escapeTo`.
 */
function useListKeys<T extends HTMLElement>(
  escapeTo?: RefObject<HTMLElement | null>,
) {
  const list = useRef<T | null>(null);
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const items = Array.from(
      list.current?.querySelectorAll<HTMLElement>("[data-lens-item]") ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") next = Math.min(items.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape" && escapeTo?.current) {
      event.preventDefault();
      escapeTo.current.focus();
      return;
    } else return;
    event.preventDefault();
    items[next]?.focus();
  }
  return { list, onKeyDown };
}

function Excerpt({ segments }: { segments: ExcerptSegment[] }) {
  return (
    <span className="lens-excerpt">
      {segments.map((s, i) =>
        s.highlight ? (
          <mark key={i}>{s.text}</mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

function ArchivedToggle({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="lens-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />{" "}
      Include archived
    </label>
  );
}

function gardenArchived(data: GardenData) {
  return (
    data.gardens.find((g) => g.id === data.gardenId)?.status === "archived"
  );
}

/**
 * Bounded search across thought titles and entry bodies with excerpt
 * highlighting. Results open the entry in its thought; nothing is ranked by
 * engagement, only by where and how recently the words appear.
 */
export function GardenSearch({
  data,
  plotId,
  archived,
  query,
  onQueryChange,
  onNavigate,
}: {
  data: GardenData;
  plotId: string;
  archived: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onNavigate: LensNavigate;
}) {
  const [includeArchived, setIncludeArchived] = useState(archived);
  const inputId = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const { list, onKeyDown } = useListKeys<HTMLOListElement>(input);
  const trimmed = query.trim();
  const hits =
    trimmed.length >= MIN_QUERY_LENGTH
      ? searchGarden(query, {
          seeds: data.seeds,
          entries: data.entries,
          plots: data.plots,
          plotId,
          includeArchived: includeArchived || archived,
          gardenArchived: gardenArchived(data),
        })
      : [];
  const plotName = (id: string) => data.plots.find((p) => p.id === id)?.name;
  return (
    <div className="lens-search">
      <div className="lens-search-row">
        <label className="search-field" htmlFor={inputId}>
          <span className="sr-only">
            Search thought titles and entries{plotId ? " in this topic" : ""}
          </span>
          <input
            ref={input}
            id={inputId}
            type="search"
            placeholder={plotId ? "Search this topic…" : "Search your garden…"}
            value={query}
            autoComplete="off"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && hits.length > 0) {
                e.preventDefault();
                list.current
                  ?.querySelector<HTMLElement>("[data-lens-item]")
                  ?.focus();
              } else if (e.key === "Escape" && query) {
                e.preventDefault();
                onQueryChange("");
              }
            }}
          />
        </label>
        {!archived && (
          <ArchivedToggle
            id={`${inputId}-archived`}
            checked={includeArchived}
            onChange={setIncludeArchived}
          />
        )}
        <button
          type="button"
          className="plain-button lens-link"
          onClick={() => onNavigate(plotId, "", "timeline")}
        >
          Timeline
        </button>
      </div>
      {trimmed.length > 0 && (
        <section className="lens-results" aria-label="Search results">
          <p className="form-note" role="status" aria-live="polite">
            {trimmed.length < MIN_QUERY_LENGTH
              ? `Type at least ${MIN_QUERY_LENGTH} characters to search.`
              : hits.length === 0
                ? "Nothing matches these words in this view."
                : `${hits.length} ${hits.length === 1 ? "match" : "matches"}${
                    hits.length >= DEFAULT_RESULT_LIMIT
                      ? ` · showing the closest ${DEFAULT_RESULT_LIMIT}`
                      : ""
                  }. Titles rank above entries; newest first.`}
          </p>
          {hits.length > 0 && (
            <ol className="lens-list" ref={list} onKeyDown={onKeyDown}>
              {hits.map((h) => (
                <li key={h.entry?.entry_id ?? `title:${h.seed.id}`}>
                  <button
                    type="button"
                    data-lens-item
                    className="lens-item"
                    onClick={() =>
                      onNavigate(
                        h.seed.plot_id,
                        h.seed.id,
                        h.archived ? "archive" : "",
                        h.entry?.entry_id,
                      )
                    }
                  >
                    <span className="lens-meta">
                      {h.kind === "title" ? "Thought" : "Entry"}
                      {h.archived ? " · archived" : ""} ·{" "}
                      {plotName(h.seed.plot_id)}
                      {h.entry && (
                        <>
                          {" · "}
                          <LensTime value={h.entry.created_at} />
                        </>
                      )}
                    </span>
                    <strong>{h.seed.title}</strong>
                    {h.kind === "entry" && <Excerpt segments={h.excerpt} />}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

function LensTime({
  value,
  timeOnly = false,
}: {
  value: string;
  timeOnly?: boolean;
}) {
  const timeZone = useHydratedTimeZone();
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString(undefined, {
        ...(timeOnly
          ? {}
          : { year: "numeric", month: "short", day: "numeric" }),
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      })}
    </time>
  );
}

function DayHeading({ entry, timeZone }: { entry: Entry; timeZone?: string }) {
  return (
    <h2>
      {new Intl.DateTimeFormat(undefined, {
        timeZone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(entry.created_at))}
    </h2>
  );
}

/**
 * Chronology lens: every saved entry in the garden (or one topic) listed by
 * calendar day, newest first. Secondary to the garden overview; it never
 * counts streaks or nudges a return.
 */
export function ChronologyLens({
  data,
  plotId,
  archived,
  onNavigate,
}: {
  data: GardenData;
  plotId: string;
  archived: boolean;
  onNavigate: LensNavigate;
}) {
  const [includeArchived, setIncludeArchived] = useState(archived);
  const [shown, setShown] = useState(DAYS_PER_PAGE);
  const toggleId = useId();
  const timeZone = useHydratedTimeZone();
  const { list, onKeyDown } = useListKeys<HTMLDivElement>();
  const plot = data.plots.find((p) => p.id === plotId);
  const garden = data.gardens.find((g) => g.id === data.gardenId);
  const days = groupEntriesByDay(
    timelineEntries({
      seeds: data.seeds,
      entries: data.entries,
      plots: data.plots,
      plotId,
      includeArchived: includeArchived || archived,
      gardenArchived: garden?.status === "archived",
    }),
    timeZone,
  );
  const visible = days.slice(0, shown);
  const total = days.reduce((n, d) => n + d.entries.length, 0);
  return (
    <div className="lens-timeline">
      <button
        type="button"
        className="plain-button back-link"
        onClick={() => onNavigate(plotId, "", archived ? "archive" : "")}
      >
        ← Back to {plot ? plot.name : "garden overview"}
      </button>
      <div className="meadow-heading">
        <p className="panel-kicker">Timeline · {plot ? "topic" : "garden"}</p>
        <h1>{plot?.name ?? garden?.name}</h1>
        <p>
          Your saved entries by day, newest first. A quieter way to see where a
          thought has been. The garden overview remains the main view.
        </p>
      </div>
      <div className="lens-search-row">
        <p className="form-note" role="status">
          {total} {total === 1 ? "entry" : "entries"} across {days.length}{" "}
          {days.length === 1 ? "day" : "days"}
          {plot ? " in this topic" : ""}.
        </p>
        {!archived && (
          <ArchivedToggle
            id={toggleId}
            checked={includeArchived}
            onChange={setIncludeArchived}
          />
        )}
      </div>
      {days.length === 0 && (
        <p className="empty-garden-note">
          No saved entries in this view yet. Open a thought to write one, or
          include archived writing.
        </p>
      )}
      <div ref={list} onKeyDown={onKeyDown}>
        {visible.map((day) => (
          <section
            className="lens-day"
            key={day.day}
            aria-labelledby={`day-${day.day}`}
          >
            <div id={`day-${day.day}`}>
              <DayHeading entry={day.entries[0]} timeZone={timeZone} />
            </div>
            <ol className="lens-list">
              {day.entries.map((e) => {
                const seed = data.seeds.find((s) => s.id === e.seed_id);
                if (!seed) return null;
                const isArchived =
                  !!e.archived_at ||
                  seed.status === "archived" ||
                  !!data.plots.find((p) => p.id === seed.plot_id)
                    ?.archived_at ||
                  garden?.status === "archived";
                return (
                  <li key={e.entry_id}>
                    <button
                      type="button"
                      data-lens-item
                      className="lens-item"
                      onClick={() =>
                        onNavigate(
                          seed.plot_id,
                          seed.id,
                          isArchived ? "archive" : "",
                          e.entry_id,
                        )
                      }
                    >
                      <span className="lens-meta">
                        <LensTime value={e.created_at} timeOnly /> ·{" "}
                        {data.plots.find((p) => p.id === seed.plot_id)?.name}
                        {isArchived ? " · archived" : ""}
                      </span>
                      <strong>{seed.title}</strong>
                      <span className="lens-excerpt">
                        {e.body.replace(/\s+/g, " ").slice(0, 200)}
                        {e.body.length > 200 ? "…" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      {days.length > shown && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => setShown(shown + DAYS_PER_PAGE)}
        >
          Show {Math.min(DAYS_PER_PAGE, days.length - shown)} earlier{" "}
          {days.length - shown === 1 ? "day" : "days"}
        </button>
      )}
    </div>
  );
}
