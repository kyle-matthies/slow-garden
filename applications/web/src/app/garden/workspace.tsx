"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { GardenData, Entry, ActionResult } from "@/lib/garden/types";
import {
  broadcastDraftsCleared,
  clearLegacySessionDrafts,
  markDraftsCleared,
  openDraftStore,
} from "@/lib/garden/drafts";
import { GardenReturns } from "./returns";
import { ChronologyLens, GardenSearch, type LensView } from "./chronology";
import { EntryTime } from "./entry-time";
import { EntryEditor } from "./entry-editor";
import { FirstRun } from "./first-run";
import { setArchived, setPlotPermissions, signOut } from "./actions";
import { NewArea } from "./new-area";
import { GardenScene } from "./scene/garden-scene";
import { ThoughtPlant, TopicPlants } from "./scene/thought-plant";

/** "" is the living garden; "list" is the structured workspace. */
type GardenView = LensView | "list";
const VIEW_PREFERENCE = "slow-garden:garden-view";

function readViewPreference(): "list" | "" {
  try {
    return localStorage.getItem(VIEW_PREFERENCE) === "list" ? "list" : "";
  } catch {
    return "";
  }
}
function writeViewPreference(view: "list" | "") {
  try {
    localStorage.setItem(VIEW_PREFERENCE, view || "garden");
  } catch {
    // The choice is a convenience; the URL still carries the view.
  }
}

function EntryCard({
  entry,
  tenantId,
  onRefresh,
  onArchive,
  readOnly = false,
}: {
  entry: Entry;
  tenantId: string;
  onRefresh: () => void;
  onArchive: () => void;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [history, setHistory] = useState<
      | {
          id: string;
          body: string;
          created_at: string;
          revision_number: number;
        }[]
      | null
    >(null),
    [error, setError] = useState("");
  async function viewHistory() {
    try {
      const response = await fetch(`/garden/history?entry=${entry.entry_id}`, {
        cache: "no-store",
      });
      if (!response.ok) throw Error();
      setHistory(await response.json());
    } catch {
      setError("History could not be loaded. Please retry.");
    }
  }
  return (
    <article
      className="journal-entry"
      id={`entry-${entry.entry_id}`}
      tabIndex={-1}
    >
      <EntryTime value={entry.created_at} />
      {Date.parse(entry.revised_at) > Date.parse(entry.created_at) && (
        <p className="form-note">
          Revised <EntryTime value={entry.revised_at} />
        </p>
      )}
      {entry.archived_at && <p className="form-note">Archived entry</p>}
      {editing ? (
        <EntryEditor
          tenantId={tenantId}
          seedId={entry.seed_id}
          entry={entry}
          onSaved={() => {
            setEditing(false);
            setHistory(null);
            onRefresh();
          }}
        />
      ) : (
        <p className="entry-body">{entry.body}</p>
      )}
      <div className="entry-actions">
        <button
          disabled={readOnly || !!entry.archived_at}
          onClick={() => setEditing(!editing)}
          className="plain-button"
        >
          {editing ? "Close editor" : "Revise"}
        </button>
        <button
          className="plain-button"
          onClick={() => (history ? setHistory(null) : viewHistory())}
        >
          {history ? "Close history" : "Revision history"}
        </button>
        <button
          disabled={readOnly}
          className="plain-button"
          onClick={onArchive}
        >
          {entry.archived_at ? "Restore entry" : "Archive entry"}
        </button>
      </div>
      {history && (
        <ol className="revision-list" aria-label="Revision history">
          {history.map((r) => (
            <li key={r.id}>
              <EntryTime value={r.created_at} />
              <p className="entry-body">{r.body}</p>
            </li>
          ))}
        </ol>
      )}
      <p role="status">{error}</p>
    </article>
  );
}
export function GardenWorkspace({ data }: { data: GardenData }) {
  const [editorGeneration, setEditorGeneration] = useState(0);
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(""),
    [settings, setSettings] = useState(false),
    [notice, setNotice] = useState(""),
    [savedEntry, setSavedEntry] = useState(""),
    [quietPage, setQuietPage] = useState(false),
    [firstRun, setFirstRun] = useState(() => data.gardens.length === 0);
  const garden = data.gardens.find((g) => g.id === data.gardenId);
  const requestedTopic = params.get("topic") ?? "";
  const requestedThought = params.get("thought") ?? "";
  const plotId = data.plots.find((p) => p.id === requestedTopic)?.id ?? "";
  const seedId =
    data.seeds.find((s) => s.id === requestedThought && s.plot_id === plotId)
      ?.id ?? "";
  const requestedView = params.get("view") ?? "";
  const archived = requestedView === "archive";
  const timeline = requestedView === "timeline";
  const listMode = requestedView === "list";
  const view: GardenView = archived
    ? "archive"
    : timeline
      ? "timeline"
      : listMode
        ? "list"
        : "";
  // The living garden is the default overview; the list view, timeline and
  // archive keep the structured workspace.
  const sceneMode = view === "" && !!garden && !firstRun;
  const requestedFocus = params.get("focus") ?? "";
  const focusId =
    sceneMode && !requestedThought
      ? (data.seeds.find(
          (s) =>
            s.id === requestedFocus &&
            s.status === "active" &&
            (!plotId || s.plot_id === plotId),
        )?.id ?? "")
      : "";
  const invalidLocation =
    (!!requestedTopic && !plotId) ||
    (!!requestedThought && !seedId) ||
    (!!requestedFocus && sceneMode && !requestedThought && !focusId) ||
    (!!params.get("garden") && params.get("garden") !== data.gardenId);
  function gardenUrl(
    topic: string,
    thought: string,
    nextView: GardenView,
    entry = "",
    focus = "",
  ) {
    const query = new URLSearchParams();
    if (data.gardenId) query.set("garden", data.gardenId);
    if (topic) query.set("topic", topic);
    if (thought) query.set("thought", thought);
    if (focus) query.set("focus", focus);
    if (nextView) query.set("view", nextView);
    return `/garden?${query}${entry ? `#entry-${entry}` : ""}`;
  }
  function navigate(
    topic = "",
    thought = "",
    nextView: GardenView = view,
    entry = "",
    focus = "",
  ) {
    window.history.pushState(
      null,
      "",
      gardenUrl(topic, thought, nextView, entry, focus),
    );
    setSearch("");
    setSavedEntry("");
    setQuietPage(false);
  }
  /** Lenses return to "" for the overview; honour the remembered view. */
  const navigateFromLens = (
    topic: string,
    thought: string,
    nextView: LensView,
    entry?: string,
  ) => navigate(topic, thought, nextView || readViewPreference(), entry);
  function chooseView(next: "list" | "") {
    writeViewPreference(next);
    navigate(plotId, seedId, next);
  }
  // Return to the list view on later visits if that was the last choice.
  useEffect(() => {
    if (!params.get("view") && readViewPreference() === "list")
      window.history.replaceState(
        null,
        "",
        gardenUrl(
          plotId,
          seedId,
          "list",
          window.location.hash.startsWith("#entry-")
            ? window.location.hash.slice(7)
            : "",
        ),
      );
    // Only on arrival; later navigation carries the view in the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setPlotId = (id: string) => navigate(id);
  const setSeedId = (id: string) =>
    navigate(data.seeds.find((s) => s.id === id)?.plot_id ?? plotId, id);
  useEffect(() => {
    const anchor =
      savedEntry && data.entries.some((e) => e.entry_id === savedEntry)
        ? `entry-${savedEntry}`
        : window.location.hash.slice(1);
    if (anchor)
      document.getElementById(anchor)?.scrollIntoView({ block: "center" });
  }, [params, data.entries, savedEntry]);
  const plots = data.plots.filter((p) =>
    archived
      ? garden?.status === "archived" ||
        !!p.archived_at ||
        data.seeds.some(
          (s) =>
            s.plot_id === p.id &&
            (s.status === "archived" ||
              data.entries.some((e) => e.seed_id === s.id && e.archived_at)),
        )
      : !p.archived_at,
  );
  const plot = data.plots.find((p) => p.id === plotId);
  const seed = data.seeds.find((s) => s.id === seedId);
  const entries = data.entries
    .filter(
      (e) =>
        e.seed_id === seedId &&
        (archived
          ? garden?.status === "archived" ||
            !!e.archived_at ||
            seed?.status === "archived" ||
            !!plot?.archived_at
          : !e.archived_at),
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) ||
        b.entry_id.localeCompare(a.entry_id),
    );
  const seeds = data.seeds.filter(
    (s) =>
      (!plot || s.plot_id === plot.id) &&
      (archived
        ? garden?.status === "archived" ||
          s.status === "archived" ||
          !!data.plots.find((p) => p.id === s.plot_id)?.archived_at ||
          data.entries.some((e) => e.seed_id === s.id && e.archived_at)
        : s.status === "active" &&
          !data.plots.find((p) => p.id === s.plot_id)?.archived_at) &&
      (s.title.toLowerCase().includes(search.toLowerCase()) ||
        data.entries.some(
          (e) =>
            e.seed_id === s.id &&
            e.body.toLowerCase().includes(search.toLowerCase()),
        )),
  );
  function refresh() {
    router.refresh();
  }
  async function mutation(
    action: () => Promise<ActionResult>,
    success = "Permissions saved.",
  ) {
    try {
      const result = await action();
      setNotice(result.ok ? success : result.message);
      if (result.ok) refresh();
    } catch {
      setNotice("Could not save. Please retry.");
    }
  }
  async function archiveItem(
    kind: "garden" | "plot" | "seed" | "entry",
    id: string,
    archive: boolean,
  ) {
    const label =
      kind === "plot" ? "topic" : kind === "seed" ? "thought" : kind;
    if (
      archive &&
      !window.confirm(
        `Archive this ${label}? It will be hidden from active views, not deleted. Find it in Archive to restore it. Any unsaved draft stays in this browser.`,
      )
    )
      return;
    await mutation(
      () => setArchived(kind, id, archive),
      archive
        ? `${label} archived. Find it in Archive; your writing was not deleted.`
        : `${label} restored. It is available in active views.`,
    );
  }
  async function leave(scope: "local" | "global" = "local") {
    if (
      !window.confirm(
        "Sign out and clear this browser’s unsaved drafts? Save any writing you want to keep first.",
      )
    )
      return;
    try {
      await signOut(scope);
    } catch {
      setNotice(
        "Could not sign out. Your drafts are still here; please retry.",
      );
      return;
    }
    try {
      let safeLocalStorage: Storage | null = null;
      try {
        safeLocalStorage = localStorage;
      } catch {
        safeLocalStorage = null;
      }
      markDraftsCleared(safeLocalStorage, data.tenantId);
      broadcastDraftsCleared(data.tenantId);
      const store = await openDraftStore();
      await store?.clear(data.tenantId);
      clearLegacySessionDrafts(sessionStorage, data.tenantId);
    } catch {
      // Sign out still succeeds if browser storage is unavailable.
    }
    router.replace("/login");
    router.refresh();
  }
  const sceneOverview = sceneMode && !seed;
  const activePlots = data.plots.filter((p) => !p.archived_at);
  return (
    <main
      className={`thinking-garden${sceneOverview ? " scene-mode" : ""}${sceneMode && seed ? " over-scene" : ""}`}
    >
      <a className="skip-link" href="#garden-content">
        Skip to your thoughts
      </a>
      {sceneMode && seed && garden && (
        <GardenScene
          garden={garden}
          plots={activePlots}
          seeds={data.seeds}
          entries={data.entries}
          topicId={seed.plot_id}
          focusId=""
          mode="backdrop"
        />
      )}
      <header className="garden-top">
        <Link href={`/garden?garden=${data.gardenId}`} className="wordmark">
          Slow Garden<span className="wordmark-dot">✳</span>
        </Link>
        <nav aria-label="Garden tools">
          {sceneOverview && data.gardens.length > 1 && (
            <label className="garden-switch">
              <span className="visually-hidden">Your garden</span>
              <select
                value={data.gardenId}
                onChange={(e) => router.push(`/garden?garden=${e.target.value}`)}
              >
                {data.gardens.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                    {g.status === "archived" ? " · archived" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {garden && !firstRun && !archived && !timeline && (
            <div className="view-toggle" role="group" aria-label="Garden view">
              <button
                type="button"
                aria-pressed={view === ""}
                onClick={() => chooseView("")}
              >
                Garden
              </button>
              <button
                type="button"
                aria-pressed={view === "list"}
                onClick={() => chooseView("list")}
              >
                List
              </button>
            </div>
          )}
          <button
            className="plain-button"
            onClick={() => setSettings(!settings)}
          >
            {settings ? "Close settings" : "Settings & export"}
          </button>
          <button
            className="plain-button"
            onClick={() => {
              navigate("", "", archived ? readViewPreference() : "archive");
            }}
          >
            {archived ? "Back to garden" : "Archive"}
          </button>
        </nav>
      </header>
      {settings && (
        <section className="garden-settings">
          <h2>Your space, your control</h2>
          <p>
            Your writing is stored in your private account. AI is optional and
            each topic starts with it off.
          </p>
          <div className="action-row">
            <a className="secondary-button" href="/garden/export">
              Export all sources · JSON
            </a>
            <a className="secondary-button" href="/garden/export?format=md">
              Export all sources · Markdown
            </a>
            {data.gardenId && (
              <>
                <a
                  className="secondary-button"
                  href={`/garden/export?garden=${data.gardenId}`}
                >
                  Export this garden · JSON
                </a>
                <a
                  className="secondary-button"
                  href={`/garden/export?format=md&garden=${data.gardenId}`}
                >
                  Export this garden · Markdown
                </a>
              </>
            )}
            <Link
              className="secondary-button"
              href={`/garden/import?garden=${data.gardenId}`}
            >
              Import notes
            </Link>
          </div>
          <p>
            Exports include archived writing and every revision, with
            AI-derived blooms kept in a separate section from your own words.
            Unsaved drafts stay privately in this browser until saved or discarded.
          </p>
          <p>
            You stay signed in on this browser between visits, until you sign
            out or the session expires.
          </p>
          <div className="action-row">
            <button className="plain-button" onClick={() => leave()}>
              Sign out on this device
            </button>
            <button className="plain-button" onClick={() => leave("global")}>
              Sign out on all devices
            </button>
          </div>
        </section>
      )}
      {sceneOverview && garden ? (
        <div id="garden-content" className="scene-host">
          <GardenScene
            garden={garden}
            plots={activePlots}
            seeds={data.seeds}
            entries={data.entries}
            topicId={plotId}
            focusId={focusId}
            canWrite={garden.status === "active"}
            onTopic={(id) => navigate(id, "", "")}
            onFocus={(id) => navigate(plotId, "", "", "", id)}
            onOpenThought={(id) => setSeedId(id)}
            onListView={(id) => navigate(id, "", "list")}
            newTopic={
              <NewArea
                kind="plot"
                parentId={data.gardenId}
                onCreated={(id) => {
                  navigate(id, "", "");
                  refresh();
                }}
              />
            }
            newThought={(pid) => (
              <NewArea
                kind="seed"
                parentId={pid}
                onCreated={(id) => {
                  navigate(pid, id, "");
                  refresh();
                }}
              />
            )}
          />
          {(notice || invalidLocation) && (
            <p className="scene-status" role="status">
              {invalidLocation
                ? "That location is no longer available. Showing its nearest available parent."
                : notice}
            </p>
          )}
        </div>
      ) : (
      <div className={`garden-frame${quietPage ? " quiet-page" : ""}`}>
        <aside className="plot-rail">
          <label className="panel-kicker" htmlFor="garden-choice">
            Your garden
          </label>
          <select
            id="garden-choice"
            aria-label="Your garden"
            value={data.gardenId}
            onChange={(e) => {
              router.push(`/garden?garden=${e.target.value}`);
            }}
          >
            {data.gardens.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.status === "archived" ? " · archived" : ""}
              </option>
            ))}
          </select>
          <button
            className="rail-link"
            aria-current={!plotId && !seedId ? "page" : undefined}
            onClick={() => {
              navigate();
            }}
          >
            Garden overview
          </button>
          <p className="panel-kicker">Topics</p>
          {plots.map((p) => (
            <button
              className="rail-link"
              aria-current={plotId === p.id ? "page" : undefined}
              key={p.id}
              onClick={() => {
                setPlotId(p.id);
                setSearch("");
              }}
            >
              <span aria-hidden="true">◌</span> {p.name}
              <small>
                {!p.ai_enabled
                  ? "AI off"
                  : p.cross_pollinate
                    ? "Cross-pollination on"
                    : "AI permission on"}
              </small>
            </button>
          ))}
          {data.gardenId && garden?.status === "active" && !archived && (
            <NewArea
              kind="plot"
              parentId={data.gardenId}
              onCreated={(id) => {
                setPlotId(id);
                refresh();
              }}
            />
          )}
          {garden && (
            <div className="more-gardens">
              <NewArea
                kind="garden"
                parentId=""
                onCreated={(id) => {
                  router.push(`/garden?garden=${id}`);
                  refresh();
                }}
              />
            </div>
          )}
        </aside>
        <section
          id="garden-content"
          className={seed ? "thought-page" : "meadow-page"}
        >
          <nav className="garden-breadcrumb" aria-label="Breadcrumb">
            <button onClick={() => navigate()}>
              Garden: {garden?.name ?? "New garden"}
            </button>
            {plot && (
              <>
                <span aria-hidden="true">/</span>
                <button onClick={() => navigate(plot.id)}>
                  Topic: {plot.name}
                </button>
              </>
            )}
            {seed && (
              <>
                <span aria-hidden="true">/</span>
                <span aria-current="page">Thought: {seed.title}</span>
              </>
            )}
          </nav>
          {invalidLocation && (
            <p role="status">
              That location is no longer available. Showing its nearest
              available parent.
            </p>
          )}
          {archived && (
            <section className="archive-notice">
              <h2>Archive</h2>
              <p>
                Archived writing is hidden from active views, not deleted.
                Restore its garden or topic first, then the thought or entry.
              </p>
            </section>
          )}
          {garden?.status === "archived" && (
            <p className="archive-notice">
              This garden is archived.{" "}
              <button onClick={() => archiveItem("garden", garden.id, false)}>
                Restore garden
              </button>
            </p>
          )}
          {plot?.archived_at && (
            <p className="archive-notice">
              This topic is archived.{" "}
              <button
                disabled={garden?.status === "archived"}
                onClick={() => archiveItem("plot", plot.id, false)}
              >
                Restore topic
              </button>
            </p>
          )}

          {firstRun || !garden ? (
            <FirstRun
              tenantId={data.tenantId}
              onDone={({ gardenId, topicId, thoughtId, entryId }) => {
                setFirstRun(false);
                const query = new URLSearchParams({
                  garden: gardenId,
                  topic: topicId,
                  thought: thoughtId,
                });
                router.push(
                  `/garden?${query}${entryId ? `#entry-${entryId}` : ""}`,
                );
                refresh();
              }}
            />
          ) : timeline && !seed ? (
            <ChronologyLens
              key={`${data.gardenId}:${plotId}`}
              data={data}
              plotId={plotId}
              archived={archived}
              onNavigate={navigateFromLens}
            />
          ) : seed ? (
            <>
              <button
                className="plain-button back-link"
                onClick={() => setSeedId("")}
              >
                ← Back to {plot?.name ?? "your garden"}
              </button>
              <div className="thought-heading">
                <div>
                  <p className="panel-kicker">An evolving thought</p>
                  <h1>{seed.title}</h1>
                  <p>
                    A named thread of thought. Add a dated entry whenever you
                    return.
                  </p>
                </div>
                <ThoughtPlant seedId={seed.id} entries={data.entries} />
              </div>
              <a className="text-link" href="#saved-entries">
                View {entries.length} saved{" "}
                {entries.length === 1 ? "entry" : "entries"}
              </a>
              {seed.status === "active" &&
                garden.status === "active" &&
                !data.plots.find((p) => p.id === seed.plot_id)?.archived_at && (
                  <EntryEditor
                    key={`${data.gardenId}:${seed.id}:${editorGeneration}`}
                    tenantId={data.tenantId}
                    seedId={seed.id}
                    onSaved={(id) => {
                      setNotice("Entry saved to this thought.");
                      setSavedEntry(id);
                      refresh();
                    }}
                    quietPage={quietPage}
                    onQuietPageChange={setQuietPage}
                  />
                )}
              <div className="journal-entries" id="saved-entries">
                <h2>Saved entries · {entries.length}</h2>
                {entries.length === 0 && (
                  <p>
                    No saved entries in this view. Save your first entry above,
                    or check Archive.
                  </p>
                )}
                {entries.map((e) => (
                  <EntryCard
                    key={e.entry_id}
                    entry={e}
                    tenantId={data.tenantId}
                    onRefresh={refresh}
                    readOnly={
                      seed.status === "archived" ||
                      garden.status === "archived" ||
                      !!plot?.archived_at
                    }
                    onArchive={() =>
                      archiveItem("entry", e.entry_id, !e.archived_at)
                    }
                  />
                ))}
              </div>
              <p className="form-note">
                {seed.status === "archived"
                  ? "This thought is archived. Restore it to add entries."
                  : "Archiving hides this thought from active views without deleting its entries."}
              </p>
              <button
                className="plain-button"
                disabled={garden.status === "archived" || !!plot?.archived_at}
                onClick={() =>
                  archiveItem("seed", seed.id, seed.status === "active")
                }
              >
                {seed.status === "archived"
                  ? "Restore this thought"
                  : "Archive thought"}
              </button>
            </>
          ) : (
            <>
              <div className="meadow-heading">
                <p className="panel-kicker">
                  {archived
                    ? "Archived writing"
                    : plot
                      ? "Topic · related thoughts"
                      : "Garden overview"}
                </p>
                <h1>{plot?.name ?? garden.name}</h1>
                <p>
                  {plot
                    ? "Choose a thought to read its entries or add a new one."
                    : "Topics group your thoughts. Each thought holds dated entries."}
                </p>
              </div>
              <div className="meadow-tools">
                <GardenSearch
                  key={`${data.gardenId}:${plotId}:${view}`}
                  data={data}
                  plotId={plotId}
                  archived={archived}
                  query={search}
                  onQueryChange={setSearch}
                  onNavigate={navigateFromLens}
                />
                {plot &&
                  garden.status === "active" &&
                  !plot.archived_at &&
                  !archived && (
                    <NewArea
                      kind="seed"
                      parentId={plot.id}
                      onCreated={(id) => {
                        setSeedId(id);
                        refresh();
                      }}
                    />
                  )}
              </div>
              {!plot && !search && plots.length > 0 && (
                <div className="plot-overview">
                  {plots.map((p) => (
                    <button
                      className="plot-card"
                      key={p.id}
                      onClick={() => setPlotId(p.id)}
                    >
                      <TopicPlants
                        seedIds={data.seeds
                          .filter((s) => s.plot_id === p.id && s.status === "active")
                          .map((s) => s.id)}
                        entries={data.entries}
                      />
                      <p className="panel-kicker">
                        Topic{p.archived_at ? " · archived" : ""}
                      </p>
                      <h2>{p.name}</h2>
                      <p>
                        {
                          data.seeds.filter(
                            (s) => s.plot_id === p.id && s.status === "active",
                          ).length
                        }{" "}
                        open thoughts
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {!search && (
                <h2>{plot ? "Thoughts in this topic" : "All thoughts"}</h2>
              )}
              <section className="plant-grid" aria-label="Thoughts">
                {(search ? [] : seeds).map((s) => (
                  <button
                    className="seed-plant"
                    key={s.id}
                    onClick={() => {
                      navigate(s.plot_id, s.id);
                    }}
                  >
                    <ThoughtPlant seedId={s.id} entries={data.entries} />
                    <small>
                      Thought{s.status === "archived" ? " · archived" : ""}
                    </small>
                    <span className="plant-label">{s.title}</span>
                    <small>
                      {data.plots.find((p) => p.id === s.plot_id)?.name}
                    </small>
                    <small>
                      {
                        data.entries.filter(
                          (e) => e.seed_id === s.id && !e.archived_at,
                        ).length
                      }{" "}
                      saved entries
                    </small>
                    <small>
                      {(() => {
                        const latest = data.entries
                          .filter((e) => e.seed_id === s.id && !e.archived_at)
                          .sort((a, b) =>
                            b.created_at.localeCompare(a.created_at),
                          )[0];
                        return latest ? (
                          <>
                            Latest: <EntryTime value={latest.created_at} />
                          </>
                        ) : (
                          "No entries yet"
                        );
                      })()}
                    </small>
                  </button>
                ))}
              </section>
              {seeds.length === 0 && !search && (
                <p className="empty-garden-note">
                  {plot
                    ? "Create a thought in this topic, then save your first dated entry."
                    : "Create a topic for related thoughts, then add a thought and its first entry."}
                </p>
              )}
              {!plot && !archived && !search && (
                <section className="recent-entries">
                  <h2>Recent entries</h2>
                  <p>Your latest saved writing in this garden.</p>
                  {data.entries
                    .filter(
                      (e) =>
                        !e.archived_at && seeds.some((s) => s.id === e.seed_id),
                    )
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .slice(0, 10)
                    .map((e) => {
                      const thought = data.seeds.find(
                        (s) => s.id === e.seed_id,
                      )!;
                      return (
                        <button
                          key={e.entry_id}
                          className="recent-entry"
                          onClick={() =>
                            navigate(
                              thought.plot_id,
                              thought.id,
                              "",
                              e.entry_id,
                            )
                          }
                        >
                          <strong>{thought.title}</strong>
                          <span>
                            {
                              data.plots.find((p) => p.id === thought.plot_id)
                                ?.name
                            }
                          </span>
                          <EntryTime value={e.created_at} />
                          <span>
                            {e.body.slice(0, 160)}
                            {e.body.length > 160 ? "…" : ""}
                          </span>
                        </button>
                      );
                    })}
                  {!data.entries.some(
                    (e) =>
                      !e.archived_at && seeds.some((s) => s.id === e.seed_id),
                  ) && (
                    <p>
                      No saved entries yet. Choose a topic to begin, or check
                      Archive.
                    </p>
                  )}
                </section>
              )}
              {plot && (
                <GardenReturns
                  key={plot.id}
                  data={data}
                  plotId={plot.id}
                  onContinue={(id) => {
                    setSeedId(id);
                    setEditorGeneration((n) => n + 1);
                  }}
                />
              )}
              {plot && (
                <details className="plot-permissions">
                  <summary>
                    Topic settings ·{" "}
                    {!plot.ai_enabled
                      ? "AI off"
                      : plot.cross_pollinate
                        ? "Cross-pollination on"
                        : "AI permission on"}
                  </summary>
                  <p>
                    AI tending is optional. Cross-pollination lets this topic
                    exchange context with other participating topics in this
                    garden.
                  </p>
                  {!data.aiAvailable && (
                    <p>
                      AI reflections are not available yet. These permissions
                      are saved for when the service becomes available.
                    </p>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      disabled={
                        !!plot.archived_at || garden.status === "archived"
                      }
                      checked={plot.ai_enabled}
                      onChange={(e) =>
                        mutation(() =>
                          setPlotPermissions(
                            plot.id,
                            e.target.checked,
                            plot.cross_pollinate,
                          ),
                        )
                      }
                    />{" "}
                    Allow AI tending
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={plot.cross_pollinate}
                      disabled={
                        !plot.ai_enabled ||
                        !!plot.archived_at ||
                        garden.status === "archived"
                      }
                      onChange={(e) =>
                        mutation(() =>
                          setPlotPermissions(
                            plot.id,
                            plot.ai_enabled,
                            e.target.checked,
                          ),
                        )
                      }
                    />{" "}
                    Allow cross-pollination
                  </label>
                  <p>
                    {plot.ai_enabled && !plot.cross_pollinate
                      ? "This topic’s writing and insights stay isolated from other topics."
                      : "Every participating topic must give its own permission."}
                  </p>
                  <p>
                    Permissions never trigger processing by themselves. Invite
                    AI separately when you want a reflection.
                  </p>
                  <button
                    className="plain-button"
                    disabled={garden.status === "archived"}
                    onClick={() =>
                      archiveItem("plot", plot.id, !plot.archived_at)
                    }
                  >
                    {plot.archived_at ? "Restore topic" : "Archive topic"}
                  </button>
                </details>
              )}
            </>
          )}
          <p className="save-notice" role="status">
            {notice}
          </p>
        </section>
      </div>
      )}
      {!sceneOverview && (
        <footer className="garden-foot">
          Yours to write. Yours to leave unfinished.
        </footer>
      )}
    </main>
  );
}
