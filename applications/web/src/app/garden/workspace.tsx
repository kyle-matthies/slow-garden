"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import "./level-pages.css";
import { loadOnboardingDraft } from "@/lib/garden/onboarding-draft";
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
import {
  useGardenReload,
  useGardenRefreshFailed,
  useGardenStore,
} from "@/lib/garden/store/context";
import { ExportLink } from "./export-link";
import { TendingSettings } from "./tending-settings";
import { DeleteControl } from "./delete-control";
import { discardDeletedDrafts } from "./delete-drafts";
import { DeleteZone } from "./delete-zone";
import { TendingActivity } from "./tending-activity";
import { RecentWriting } from "./recent-writing";
import { NewArea } from "./new-area";
import { ToolsMenu } from "./tools-menu";
import { GardenRing } from "./scene/garden-ring";
import { GardenScene } from "./scene/garden-scene";
import { useSeenReceiptsReady, useSeenTending } from "@/lib/garden/use-seen-tending";
import { ThoughtPlant, TopicPlants } from "./scene/thought-plant";
import { LevelEyebrow, LevelGlyph } from "./level-glyphs";
import { LevelTrail, type TrailStep } from "./level-trail";
import { TENDING_LABEL, tendingLabel, tendingState, type TendingState } from "./level-vocabulary";
import { ReturnsPage, liveBlooms } from "./level-returns";
import { MorningReturn } from "./morning-return";
import { NavGlyph, focusWritingPage, pickWritingThought } from "./level-nav";

/**
 * "" is Meadow (the living scene), "list" is Pages (the same garden on paper),
 * "gardens" the ring of all gardens and "returns" the page of AI-derived blooms.
 * The stored values predate the Meadow / Pages names and are kept for old links.
 */
type GardenView = LensView | "list" | "gardens" | "returns";
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
  onDeleted,
  deletionAvailable = false,
  readOnly = false,
}: {
  entry: Entry;
  tenantId: string;
  onRefresh: () => void;
  onArchive: () => void;
  onDeleted: () => void | Promise<void>;
  deletionAvailable?: boolean;
  readOnly?: boolean;
}) {
  const { loadEntryHistory } = useGardenStore();
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
      const result = await loadEntryHistory(entry.entry_id);
      if (!result.ok) throw Error();
      setHistory(result.revisions);
    } catch {
      setError("History could not be loaded. Please retry.");
    }
  }
  const revised = Date.parse(entry.revised_at) > Date.parse(entry.created_at);
  return (
    <article
      className="journal-entry entry-page"
      id={`entry-${entry.entry_id}`}
      tabIndex={-1}
    >
      <header className="entry-page-head">
        <LevelEyebrow level="entry">
          {entry.archived_at ? "Archived" : undefined}
        </LevelEyebrow>
        <h3 className="entry-page-date">
          <EntryTime value={entry.created_at} />
        </h3>
        <p className="entry-revision">
          {revised ? (
            <>
              Revision {entry.revision_number} · revised{" "}
              <EntryTime value={entry.revised_at} />
            </>
          ) : (
            "As first written"
          )}
        </p>
      </header>
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
          aria-expanded={!!history}
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
        <DeleteControl
          enabled={deletionAvailable}
          kind="entry"
          id={entry.entry_id}
          name="this entry"
          onDeleted={onDeleted}
        />
      </div>
      {history && (
        <ol className="revision-list" aria-label="Revision history">
          {history.map((r) => (
            <li key={r.id}>
              <p className="revision-stamp">
                Revision {r.revision_number} ·{" "}
                <EntryTime value={r.created_at} />
              </p>
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
  const {
    respondToMark,
    setArchived,
    setTopicTending: setPlotPermissions,
    signOut,
    kind: storeKind,
  } = useGardenStore();
  // Browser mode: the garden is client state and is re-read through the store.
  // Server mode (null): the server re-renders it, exactly as before.
  const reloadGarden = useGardenReload();
  const { tending, markBloomsSeen } = useSeenTending(data.tenantId, data.tending);
  // "New" is known only once this browser's receipts are read: announce nothing
  // on the server or mid-hydration, so a dismissed reveal never flashes back.
  const receiptsReady = useSeenReceiptsReady();
  const [editorGeneration, setEditorGeneration] = useState(0);
  const router = useRouter();
  const params = useSearchParams();
  // Browser mode only: the last re-read failed and the page shows the last
  // good data. Said beside whatever the last action reported.
  const refreshFailed = useGardenRefreshFailed();
  const [search, setSearch] = useState(""),
    [settings, setSettings] = useState(false),
    [said, setNotice] = useState(""),
    [savedEntry, setSavedEntry] = useState(""),
    [quietPage, setQuietPage] = useState(false),
    [firstRun, setFirstRun] = useState(() => data.gardens.length === 0);
  const notice = refreshFailed
    ? `${said}${said ? " " : ""}The garden could not be refreshed, so this page may be out of date. Nothing was lost; reload the page to check.`
    : said;
  const firstRunCompleted = useRef(false);
  const sceneHost = useRef<HTMLDivElement>(null);
  // Setup may already have saved a garden before a reload. Recover the remaining
  // steps without letting a delayed read reopen a flow completed in this mount.
  useEffect(() => {
    let cancelled = false;
    firstRunCompleted.current = false;
    void loadOnboardingDraft(data.tenantId).then((saved) => {
      if (!cancelled && !firstRunCompleted.current && saved) setFirstRun(true);
    });
    return () => { cancelled = true; };
  }, [data.tenantId]);
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
  const returnsMode = requestedView === "returns";
  const view: GardenView = archived
    ? "archive"
    : timeline
      ? "timeline"
      : listMode
        ? "list"
        : returnsMode
          ? "returns"
          : requestedView === "gardens"
            ? "gardens"
            : "";
  const ringMode = view === "gardens" && !firstRun && data.gardens.length > 0;
  // The living garden is the default overview; Pages, timeline and
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
  /** Meadow or Pages, whichever the person is in or last chose. */
  const homeView = (): "list" | "" =>
    view === "" || view === "list" ? view : readViewPreference();
  // Return to Pages on later visits if that was the last choice.
  useEffect(() => {
    if (!params.get("view") && readViewPreference() === "list") {
      // Only the view is added. The address keeps the garden, topic and
      // thought it asked for, found or not: rebuilding it from what was found
      // dropped a location that no longer exists, and with it the notice
      // that says so.
      const query = new URLSearchParams(params.toString());
      if (!query.get("garden") && data.gardenId)
        query.set("garden", data.gardenId);
      query.set("view", "list");
      window.history.replaceState(
        null,
        "",
        `/garden?${query}${window.location.hash.startsWith("#entry-") ? window.location.hash : ""}`,
      );
    }
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
    if (reloadGarden) void reloadGarden();
    else router.refresh();
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
  /** Permanent deletion finished: drop matching local drafts, say so, and show what remains. */
  async function afterDelete(
    label: string,
    deleted: { entryId: string } | { seedIds: readonly string[] },
    topic?: string,
  ) {
    await discardDeletedDrafts(data.tenantId, deleted);
    if (topic !== undefined) navigate(topic, "");
    setNotice(`${label} deleted permanently.`);
    refresh();
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
  const sceneOverview = (sceneMode && !seed) || ringMode;
  const activePlots = data.plots.filter((p) => !p.archived_at);
  const openThought = (id: string) =>
    navigate(
      data.seeds.find((s) => s.id === id)?.plot_id ?? plotId,
      id,
      homeView(),
    );
  const openReturns = () => navigate(plotId, "", "returns");

  // Per-thought and per-topic facts shown on bed and specimen cards.
  const countedEntries = data.entries.filter((e) => archived || !e.archived_at);
  const entryCount = new Map<string, number>();
  const firstWritten = new Map<string, string>();
  const lastWritten = new Map<string, string>();
  for (const e of countedEntries) {
    entryCount.set(e.seed_id, (entryCount.get(e.seed_id) ?? 0) + 1);
    if ((firstWritten.get(e.seed_id) ?? "9") > e.created_at)
      firstWritten.set(e.seed_id, e.created_at);
    if ((lastWritten.get(e.seed_id) ?? "") < e.created_at)
      lastWritten.set(e.seed_id, e.created_at);
  }
  const bedThoughts = (id: string) =>
    data.seeds.filter(
      (s) => s.plot_id === id && (archived || s.status === "active"),
    );
  const latestOf = (ids: string[]) =>
    ids.reduce((latest, id) => {
      const at = lastWritten.get(id) ?? "";
      return at > latest ? at : latest;
    }, "");
  const plural = (n: number, one: string, many = `${one}s`) =>
    `${n} ${n === 1 ? one : many}`;

  const unseenBlooms = receiptsReady
    ? liveBlooms(tending).filter((b) => b.isNew).length
    : 0;
  const showChrome = !!garden && !firstRun;
  // The reveal and the status note float over the Meadow. Tell the stylesheet
  // how much room the scene's own title card and topic dock take, so neither
  // is ever covered.
  const overScene = sceneMode && !seed;
  useEffect(() => {
    const host = sceneHost.current;
    if (!overScene || !host || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const top = host.getBoundingClientRect().top;
      const title = host.querySelector(".scene-title")?.getBoundingClientRect();
      const dock = host.querySelector(".scene-dock")?.getBoundingClientRect();
      if (title) host.style.setProperty("--scene-title-bottom", `${Math.ceil(title.bottom - top)}px`);
      if (dock) host.style.setProperty("--scene-dock-top", `${Math.floor(dock.top - top)}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    for (const part of host.querySelectorAll(".scene-title, .scene-dock")) observer.observe(part);
    measure();
    return () => observer.disconnect();
  }, [overScene, plotId, focusId]);

  // The depth trail: All gardens > Garden > Topic > Thought.
  const lens = timeline && !seed;
  const steps: TrailStep[] = [];
  if (showChrome) {
    const within = archived ? "archive" : homeView();
    steps.push({
      level: "gardens",
      onOpen: ringMode ? undefined : () => navigate("", "", "gardens"),
    });
    if (!ringMode) {
      const here = returnsMode || lens ? "" : seed ? "thought" : plot ? "topic" : "garden";
      steps.push({
        level: "garden",
        name: garden.name,
        onOpen: here === "garden" ? undefined : () => navigate("", "", within),
      });
      if (plot)
        steps.push({
          level: "topic",
          name: plot.name,
          onOpen:
            here === "topic" ? undefined : () => navigate(plot.id, "", within),
        });
      if (seed && !returnsMode) steps.push({ level: "thought", name: seed.title });
    }
  }

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
          tending={tending}
          mode="backdrop"
        />
      )}
      {/* One top bar: where you can go (Meadow, Pages, Returns, All gardens)
          and one menu for everything about the account. First run keeps only
          the wordmark and that menu: nothing else is rendered, not hidden. */}
      <header className="garden-top" data-chrome={showChrome || undefined}>
        <Link href={`/garden?garden=${data.gardenId}`} className="wordmark">
          <span className="wordmark-text">Slow Garden</span>
          <span className="wordmark-dot" aria-hidden="true">✳</span>
        </Link>
        <nav aria-label="Garden tools">
          {showChrome && (
            <>
              <div className="view-toggle" role="group" aria-label="View">
                <button
                  type="button"
                  aria-pressed={view === ""}
                  onClick={() => chooseView("")}
                >
                  <NavGlyph name="meadow" />
                  Meadow
                </button>
                <button
                  type="button"
                  aria-pressed={view === "list"}
                  onClick={() => chooseView("list")}
                >
                  <NavGlyph name="pages" />
                  Pages
                </button>
              </div>
              {/* Phone tab bar only: one tap to the writing page from anywhere. */}
              <button
                type="button"
                className="plain-button top-link write-link"
                onClick={() => {
                  const target = pickWritingThought(data, plotId, seedId);
                  if (!target) return navigate(plotId, "", "list");
                  if (target.id !== seedId || (view !== "" && view !== "list"))
                    navigate(target.plot_id, target.id, homeView());
                  focusWritingPage();
                }}
              >
                <NavGlyph name="write" />
                Write
              </button>
              <button
                type="button"
                className="plain-button top-link returns-link"
                aria-current={returnsMode ? "page" : undefined}
                onClick={openReturns}
              >
                <NavGlyph name="returns" />
                Returns
                {unseenBlooms > 0 && (
                  <>
                    <span className="returns-dot" aria-hidden="true" />
                    <span className="sr-only">
                      {" "}
                      ({plural(unseenBlooms, "new bloom")})
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="plain-button top-link gardens-button"
                aria-current={ringMode ? "page" : undefined}
                onClick={() => navigate("", "", "gardens")}
              >
                All gardens
                <span className="sr-only"> ({data.gardens.length})</span>
              </button>
            </>
          )}
          <ToolsMenu>
            {(close) => (
              <>
                {showChrome && (
                  <button
                    className="plain-button tools-phone-only"
                    onClick={() => {
                      close();
                      navigate("", "", "gardens");
                    }}
                  >
                    All gardens
                  </button>
                )}
                <button
                  className="plain-button"
                  onClick={() => {
                    close();
                    setSettings(!settings);
                  }}
                >
                  {settings ? "Close settings" : "Settings & export"}
                </button>
                {data.gardenId && !firstRun && (
                  <Link
                    className="plain-button"
                    href={`/garden/import?garden=${data.gardenId}`}
                    onClick={close}
                  >
                    Import notes
                  </Link>
                )}
                {showChrome && (
                  <button
                    className="plain-button"
                    onClick={() => {
                      close();
                      navigate(
                        "",
                        "",
                        archived ? readViewPreference() : "archive",
                      );
                    }}
                  >
                    {archived ? "Leave archive" : "Archive"}
                  </button>
                )}
                <button
                  className="plain-button"
                  onClick={() => {
                    close();
                    leave();
                  }}
                >
                  Sign out
                </button>
              </>
            )}
          </ToolsMenu>
        </nav>
      </header>
      {steps.length > 0 && (
        <LevelTrail
          steps={steps}
          place={
            returnsMode
              ? { name: "Returns", returns: true }
              : lens
                ? { name: "Timeline" }
                : undefined
          }
        >
          {archived && <span className="lens-chip">Archive</span>}
          {!seed && !ringMode && !returnsMode && !archived && !focusId && (
            <RecentWriting
              data={data}
              plotId={plotId}
              onNavigate={(topic, thought, entry) =>
                navigate(topic, thought, homeView(), entry)
              }
            />
          )}
        </LevelTrail>
      )}
      {settings && (
        <section className="garden-settings">
          <h2>Your space, your control</h2>
          <p>
            Your writing is stored in your private account. Tending is optional
            and every topic starts with Tending off.
          </p>
          <div className="action-row">
            <ExportLink
              className="secondary-button"
              format="json"
              onFailure={setNotice}
            >
              Export all sources · JSON
            </ExportLink>
            <ExportLink
              className="secondary-button"
              format="md"
              onFailure={setNotice}
            >
              Export all sources · Markdown
            </ExportLink>
            {data.gardenId && (
              <>
                <ExportLink
                  className="secondary-button"
                  format="json"
                  gardenId={data.gardenId}
                  onFailure={setNotice}
                >
                  Export this garden · JSON
                </ExportLink>
                <ExportLink
                  className="secondary-button"
                  format="md"
                  gardenId={data.gardenId}
                  onFailure={setNotice}
                >
                  Export this garden · Markdown
                </ExportLink>
              </>
            )}
          </div>
          <p>
            Exports include archived writing and every revision, with
            AI-derived blooms kept in a separate section from your own words.
            Unsaved drafts stay privately in this browser until saved or discarded.
          </p>
          {data.account && (
            <TendingSettings
              account={data.account}
              aiAvailable={data.aiAvailable}
              onSaved={refresh}
            />
          )}
          {garden && <TendingActivity history={data.tendingHistory} tending={tending} />}
          <p>
            You stay signed in on this browser between visits, until you sign
            out or the session expires. Sign out of this device from the More
            menu.
          </p>
          {/* What is true, per store: the server confirms each request with the
              auth server (lib/supabase/session.ts); the browser store cannot.
              Either way the data service honours an issued token until it
              expires (one hour unless the project sets otherwise). */}
          <p>
            Sign out on all devices ends every sign-in for this account.{" "}
            {storeKind === "server"
              ? "Other browsers are asked to sign in again the next time they load or save. A copy of a sign-in taken before then stops working when it expires, within about an hour."
              : "Other browsers can keep working until the access they already hold runs out, within about an hour, and are then asked to sign in again."}
          </p>
          <div className="action-row">
            <button className="plain-button" onClick={() => leave("global")}>
              Sign out on all devices
            </button>
          </div>
          <DeleteZone
            enabled={data.deletionAvailable === true}
            tenantId={data.tenantId}
            garden={garden ? { id: garden.id, name: garden.name } : undefined}
            seedIds={data.seeds.map((s) => s.id)}
          />
        </section>
      )}
      {ringMode ? (
        <div id="garden-content" className="scene-host">
          <GardenRing
            gardens={data.gardens}
            currentId={data.gardenId}
            onEnter={(id) =>
              id === data.gardenId
                ? navigate("", "", readViewPreference())
                : router.push(`/garden?garden=${id}`)
            }
            onClose={() => navigate("", "", readViewPreference())}
            newGarden={(startOpen) => (
              <NewArea
                kind="garden"
                parentId=""
                startOpen={startOpen}
                onCreated={(id) => {
                  router.push(`/garden?garden=${id}`);
                  refresh();
                }}
              />
            )}
          />
        </div>
      ) : sceneOverview && garden ? (
        <div id="garden-content" className="scene-host" ref={sceneHost}>
          {/* The morning reveal: garden level only, and only while blooms are unseen. */}
          {receiptsReady && !plotId && !focusId && (
            <MorningReturn
              tending={tending}
              seeds={data.seeds}
              plots={data.plots}
              onOpenThought={openThought}
              onOpenReturns={openReturns}
              onSeen={markBloomsSeen}
            />
          )}
          <GardenScene
            garden={garden}
            plots={activePlots}
            seeds={data.seeds}
            entries={data.entries}
            topicId={plotId}
            focusId={focusId}
            tending={tending}
            onViewBlooms={markBloomsSeen}
            canWrite={garden.status === "active"}
            onRespondMark={async (markId, response) => {
              try {
                const result = await respondToMark(
                  crypto.randomUUID(),
                  markId,
                  response,
                );
                if (!result.ok) return result.message;
                refresh();
                return null;
              } catch {
                return "Could not save your response. Please retry.";
              }
            }}
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
        <section
          id="garden-content"
          className={`level-page ${
            firstRun || !garden
              ? "level-first-run"
              : returnsMode
                ? "level-returns"
                : lens
                  ? "level-timeline"
                  : seed
                    ? "level-thought"
                    : plot
                      ? "level-topic"
                      : "level-garden"
          }`}
        >
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
              <button
                className="plain-button"
                onClick={() => navigate("", "", readViewPreference())}
              >
                Leave archive
              </button>
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
                firstRunCompleted.current = true;
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
          ) : returnsMode ? (
            /* Returns: the AI's output has its own page, in its own material. */
            <ReturnsPage
              tending={tending}
              seeds={data.seeds}
              tendingActive={data.aiAvailable}
              onOpenThought={openThought}
              onSeen={markBloomsSeen}
            >
              <GardenReturns
                key={plotId}
                data={data}
                plotId={
                  plotId ||
                  (activePlots.find((p) => p.ai_enabled) ?? activePlots[0])
                    ?.id ||
                  ""
                }
                onContinue={(id) => {
                  openThought(id);
                  setEditorGeneration((n) => n + 1);
                }}
              />
            </ReturnsPage>
          ) : lens ? (
            <ChronologyLens
              key={`${data.gardenId}:${plotId}`}
              data={data}
              plotId={plotId}
              archived={archived}
              onNavigate={navigateFromLens}
            />
          ) : seed ? (
            /* LEVEL 3 · THOUGHT: a specimen sheet. Plant and facts on the
               left, the writing page first on the right, then dated entries. */
            <div className="specimen-sheet">
              <aside className="thought-plate" aria-label="About this thought">
                <div className="specimen-frame">
                  <ThoughtPlant seedId={seed.id} entries={data.entries} />
                </div>
                <div className="specimen-label">
                  <LevelEyebrow level="thought">
                    {seed.status === "archived" ? "Archived" : undefined}
                  </LevelEyebrow>
                  <h1>{seed.title}</h1>
                  <dl className="specimen-facts">
                    <div>
                      <dt>Topic</dt>
                      <dd>{plot?.name}</dd>
                    </div>
                    <div>
                      <dt>Entries</dt>
                      <dd>
                        <a href="#saved-entries">{entries.length} saved</a>
                      </dd>
                    </div>
                    {firstWritten.has(seed.id) && (
                      <div>
                        <dt>First written</dt>
                        <dd>
                          <EntryTime
                            value={firstWritten.get(seed.id)!}
                            format="date"
                          />
                        </dd>
                      </div>
                    )}
                    {lastWritten.has(seed.id) && (
                      <div>
                        <dt>Last written</dt>
                        <dd>
                          <EntryTime
                            value={lastWritten.get(seed.id)!}
                            format="date"
                          />
                        </dd>
                      </div>
                    )}
                  </dl>
                  <div className="specimen-manage">
                    <p className="form-note">
                      {seed.status === "archived"
                        ? "This thought is archived. Restore it to add entries."
                        : "Archiving hides this thought from active views without deleting its entries."}
                    </p>
                    <button
                      className="plain-button"
                      disabled={
                        garden.status === "archived" || !!plot?.archived_at
                      }
                      onClick={() =>
                        archiveItem("seed", seed.id, seed.status === "active")
                      }
                    >
                      {seed.status === "archived"
                        ? "Restore this thought"
                        : "Archive thought"}
                    </button>
                    <DeleteControl
                      enabled={data.deletionAvailable === true}
                      kind="seed"
                      id={seed.id}
                      name={seed.title}
                      onDeleted={() =>
                        afterDelete(
                          "Thought",
                          { seedIds: [seed.id] },
                          seed.plot_id,
                        )
                      }
                    />
                  </div>
                </div>
              </aside>
              <div className="specimen-pages">
                {seed.status === "active" &&
                  garden.status === "active" &&
                  !data.plots.find((p) => p.id === seed.plot_id)
                    ?.archived_at && (
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
                  <h2>
                    Entries <span>{plural(entries.length, "dated page")}</span>
                  </h2>
                  {entries.length === 0 && (
                    <p className="empty-garden-note">
                      No saved entries in this view. Save your first entry
                      above, or check Archive.
                    </p>
                  )}
                  {/* LEVEL 4 · ENTRY: each one a dated, ruled paper page. */}
                  {entries.map((e) => (
                    <EntryCard
                      key={e.entry_id}
                      entry={e}
                      tenantId={data.tenantId}
                      onRefresh={refresh}
                      deletionAvailable={data.deletionAvailable === true}
                      readOnly={
                        seed.status === "archived" ||
                        garden.status === "archived" ||
                        !!plot?.archived_at
                      }
                      onArchive={() =>
                        archiveItem("entry", e.entry_id, !e.archived_at)
                      }
                      onDeleted={() =>
                        afterDelete("Entry", { entryId: e.entry_id })
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : plot ? (
            /* LEVEL 2 · TOPIC: one bed. A soil-edged header, then its
               thoughts as small specimen cards. */
            <>
              <header className="bed-header">
                <div className="bed-header-text">
                  <LevelEyebrow level="topic">
                    {archived ? "Archive" : undefined}
                  </LevelEyebrow>
                  <h1>{plot.name}</h1>
                  <p className="bed-meta">
                    <span>{plural(bedThoughts(plot.id).length, "thought")}</span>
                    {latestOf(bedThoughts(plot.id).map((s) => s.id)) && (
                      <span>
                        Last written{" "}
                        <EntryTime
                          value={latestOf(bedThoughts(plot.id).map((s) => s.id))}
                          format="date"
                        />
                      </span>
                    )}
                    <span
                      className="tending-chip"
                      data-state={tendingState(plot)}
                    >
                      {tendingLabel(plot)}
                    </span>
                  </p>
                </div>
                <TopicPlants
                  seedIds={bedThoughts(plot.id).map((s) => s.id)}
                  entries={data.entries}
                />
              </header>
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
                {garden.status === "active" && !plot.archived_at && !archived && (
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
              {!search && (
                <>
                  <h2 className="level-section-title">
                    Thoughts <span>planted in this topic</span>
                  </h2>
                  <section
                    className="plant-grid specimen-grid"
                    aria-label="Thoughts"
                  >
                    {seeds.map((s) => (
                      <button
                        className="seed-plant specimen-card"
                        key={s.id}
                        onClick={() => navigate(s.plot_id, s.id)}
                      >
                        <ThoughtPlant seedId={s.id} entries={data.entries} />
                        <span className="specimen-tag">
                          <span className="plant-label">{s.title}</span>
                          <small>
                            {s.status === "archived" && "Archived · "}
                            {plural(entryCount.get(s.id) ?? 0, "entry", "entries")}
                            {lastWritten.has(s.id) && (
                              <>
                                {" · "}
                                <EntryTime
                                  value={lastWritten.get(s.id)!}
                                  format="date"
                                />
                              </>
                            )}
                          </small>
                        </span>
                      </button>
                    ))}
                  </section>
                  {seeds.length === 0 && (
                    <p className="empty-garden-note">
                      Create a thought in this topic, then save your first
                      dated entry.
                    </p>
                  )}
                </>
              )}
              <details className="plot-permissions">
                <summary>Topic settings · {tendingLabel(plot)}</summary>
                <fieldset
                  className="tending-choice"
                  disabled={!!plot.archived_at || garden.status === "archived"}
                >
                  <legend>Tending for this topic</legend>
                  {(
                    [
                      ["off", "Nothing in this topic is read by AI."],
                      [
                        "on",
                        "This topic may be tended overnight. Its writing and blooms stay inside this topic.",
                      ],
                      [
                        "across",
                        "This topic may also be connected with other topics in this garden that allow the same.",
                      ],
                    ] as [TendingState, string][]
                  ).map(([state, help]) => (
                    <label key={state}>
                      <input
                        type="radio"
                        name={`tending-${plot.id}`}
                        checked={tendingState(plot) === state}
                        onChange={() =>
                          mutation(
                            () =>
                              setPlotPermissions(
                                plot.id,
                                state !== "off",
                                state === "across",
                              ),
                            `${TENDING_LABEL[state]} saved for this topic.`,
                          )
                        }
                      />
                      <span>
                        <strong>{TENDING_LABEL[state]}</strong>
                        <small>{help}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <p>
                  {data.aiAvailable
                    ? "Choosing a state never starts processing by itself. Anything tending returns appears in Returns, apart from your writing."
                    : "Tending is not active for this account yet. Your choice is saved for when it is, and nothing is read until then."}
                </p>
                <button
                  className="plain-button"
                  disabled={garden.status === "archived"}
                  onClick={() => archiveItem("plot", plot.id, !plot.archived_at)}
                >
                  {plot.archived_at ? "Restore topic" : "Archive topic"}
                </button>
                <DeleteControl
                  enabled={data.deletionAvailable === true}
                  kind="plot"
                  id={plot.id}
                  name={plot.name}
                  onDeleted={() =>
                    afterDelete(
                      "Topic",
                      {
                        seedIds: data.seeds
                          .filter((s) => s.plot_id === plot.id)
                          .map((s) => s.id),
                      },
                      "",
                    )
                  }
                />
              </details>
            </>
          ) : (
            /* LEVEL 1 · GARDEN: a landscape banner, then every topic as a
               wide bed with its plants standing in it. */
            <>
              {/* The morning reveal is the one announcement of new blooms here. */}
              {receiptsReady && !archived && (
                <MorningReturn
                  tending={tending}
                  seeds={data.seeds}
                  plots={data.plots}
                  onOpenThought={openThought}
                  onOpenReturns={openReturns}
                  onSeen={markBloomsSeen}
                />
              )}
              <header className="garden-banner">
                <svg
                  className="garden-banner-land"
                  viewBox="0 0 1200 240"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <circle className="banner-sun" cx="800" cy="112" r="30" />
                  <path
                    className="banner-hill-far"
                    d="M0 150c120-46 260-58 400-30s250 20 380-14 290-30 420 14v120H0Z"
                  />
                  <path
                    className="banner-hill-mid"
                    d="M0 190c160-52 330-48 500-14s330 14 470-22 170-20 230-6v92H0Z"
                  />
                  <path
                    className="banner-hill-near"
                    d="M0 222c200-34 420-30 640-8s400 4 560-18v44H0Z"
                  />
                </svg>
                <div className="garden-banner-text">
                  <LevelEyebrow level="garden">
                    {archived ? "Archive" : undefined}
                  </LevelEyebrow>
                  <h1>{garden.name}</h1>
                  <p className="garden-banner-meta">
                    <span>{plural(plots.length, "topic")}</span>
                    <span>{plural(seeds.length, "thought")}</span>
                    {latestOf(seeds.map((s) => s.id)) && (
                      <span>
                        Last written{" "}
                        <EntryTime
                          value={latestOf(seeds.map((s) => s.id))}
                          format="date"
                        />
                      </span>
                    )}
                  </p>
                </div>
              </header>
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
                {garden.status === "active" && !archived && (
                  <NewArea
                    kind="plot"
                    parentId={data.gardenId}
                    onCreated={(id) => {
                      setPlotId(id);
                      refresh();
                    }}
                  />
                )}
              </div>
              {!search && (
                <>
                  <h2 className="level-section-title">
                    Topics <span>the beds of this garden</span>
                  </h2>
                  <ul className="bed-list">
                    {plots.map((p) => {
                      const thoughts = bedThoughts(p.id);
                      const latest = latestOf(thoughts.map((s) => s.id));
                      // The bed's most-written thoughts stand in its soil.
                      const standing = [...thoughts]
                        .sort(
                          (a, b) =>
                            (entryCount.get(b.id) ?? 0) -
                              (entryCount.get(a.id) ?? 0) ||
                            a.id.localeCompare(b.id),
                        )
                        .slice(0, 9);
                      return (
                        <li key={p.id}>
                          <button
                            className="bed-card"
                            onClick={() => setPlotId(p.id)}
                          >
                            <span className="bed-card-text">
                              <span className="bed-card-level">
                                <LevelGlyph level="topic" size={16} />
                                Topic{p.archived_at ? " · archived" : ""}
                              </span>
                              <span className="bed-card-name">{p.name}</span>
                              <span className="bed-meta">
                                <span>
                                  {plural(thoughts.length, "thought")}
                                </span>
                                <span>
                                  {latest ? (
                                    <>
                                      Last written{" "}
                                      <EntryTime value={latest} format="date" />
                                    </>
                                  ) : (
                                    "Nothing written yet"
                                  )}
                                </span>
                                <span
                                  className="tending-chip"
                                  data-state={tendingState(p)}
                                >
                                  {tendingLabel(p)}
                                </span>
                              </span>
                            </span>
                            <span className="bed-card-plants" aria-hidden="true">
                              {standing.map((s) => (
                                <ThoughtPlant
                                  key={s.id}
                                  seedId={s.id}
                                  entries={data.entries}
                                  className="bed-plant"
                                />
                              ))}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {plots.length === 0 && (
                    <p className="empty-garden-note">
                      {archived
                        ? "Nothing in this garden is archived."
                        : "Create a topic for related thoughts, then add a thought and its first entry."}
                    </p>
                  )}
                </>
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
