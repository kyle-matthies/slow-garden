"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { GardenData, Entry, ActionResult } from "@/lib/garden/types";
import { GardenReturns } from "./returns";
import { EntryTime } from "./entry-time";
import {
  createArea,
  saveEntry,
  setArchived,
  setPlotPermissions,
  signOut,
} from "./actions";

function Plant({ identity = "garden" }: { identity?: string }) {
  const variant = Array.from(identity).reduce(
    (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
    0,
  );
  return (
    <svg className="plant-drawing" viewBox="0 0 120 130" aria-hidden="true">
      <path
        d="M60 118 Q55 78 65 32"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M61 92 C23 94 25 63 58 81 M61 73 C94 76 100 43 64 60 M64 51 C39 45 39 24 65 36"
        fill="currentColor"
        opacity=".65"
      />
      {variant % 2 === 0 ? (
        <g fill={`hsl(${variant % 360} 32% 58%)`}>
          <ellipse cx="66" cy="25" rx="8" ry="17" />
          <ellipse
            cx="66"
            cy="25"
            rx="8"
            ry="17"
            transform="rotate(60 66 25)"
          />
          <ellipse
            cx="66"
            cy="25"
            rx="8"
            ry="17"
            transform="rotate(120 66 25)"
          />
          <circle cx="66" cy="25" r="5" fill="#f1d990" />
        </g>
      ) : (
        <path
          d="M65 32 Q41 17 59 6 Q84 10 65 32"
          fill={`hsl(${variant % 360} 32% 58%)`}
        />
      )}
      <path
        d="M40 119 Q60 113 80 119"
        fill="none"
        stroke="currentColor"
        opacity=".4"
      />
    </svg>
  );
}
function NewArea({
  kind,
  parentId,
  onCreated,
}: {
  kind: "garden" | "plot" | "seed";
  parentId: string;
  onCreated: (id: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await createArea(kind, name, parentId, requestId.current);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setName("");
      setOpen(false);
      requestId.current = null;
      onCreated(result.id!);
    } catch {
      setError("Could not save. Please retry.");
    } finally {
      setPending(false);
    }
  }
  if (!open)
    return (
      <button className="secondary-button" onClick={() => setOpen(true)}>
        ＋{" "}
        {kind === "seed"
          ? "New thought"
          : `New ${kind === "plot" ? "topic" : kind}`}
      </button>
    );
  return (
    <form className="new-area" onSubmit={submit}>
      <label htmlFor={`new-${kind}`}>
        {kind === "seed"
          ? "Name your thought"
          : `Name your ${kind === "plot" ? "topic" : kind}`}
      </label>
      <p>
        {kind === "plot"
          ? "A topic groups related thoughts in this garden."
          : kind === "seed"
            ? "A thought is a named thread. Add dated entries whenever you return."
            : "A garden is a separate space containing topics and thoughts."}
      </p>
      <input
        id={`new-${kind}`}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          requestId.current = null;
        }}
        maxLength={kind === "seed" ? 160 : 120}
        required
        autoFocus
        disabled={pending}
      />
      <div className="action-row">
        <button className="primary-button" disabled={pending}>
          {pending ? "Saving…" : "Create"}
        </button>
        <button
          type="button"
          className="plain-button"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
      <p role="status">{error}</p>
    </form>
  );
}

type Draft = {
  body: string;
  entryId: string;
  revisionId: string;
  expectedRevisionId: string | null;
};
function EntryEditor({
  tenantId,
  seedId,
  entry,
  onSaved,
}: {
  tenantId: string;
  seedId: string;
  entry?: Entry;
  onSaved: (entryId: string) => void;
}) {
  const storageKey = `slow-garden:draft:v2:${tenantId}:${seedId}:${entry?.entry_id ?? "new"}`;
  const [draft, setDraft] = useState<Draft>({
    body: entry?.body ?? "",
    entryId: entry?.entry_id ?? "",
    revisionId: "",
    expectedRevisionId: entry?.revision_id ?? null,
  });
  const [ready, setReady] = useState(false),
    [pending, setPending] = useState(false),
    [status, setStatus] = useState(""),
    [storageWorks, setStorageWorks] = useState(true);
  // Browser draft hydration is intentionally a one-time external-store synchronization.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let initial: Draft = {
      body: entry?.body ?? "",
      entryId: entry?.entry_id ?? crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
      expectedRevisionId: entry?.revision_id ?? null,
    };
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed.body === "string" &&
          typeof parsed.entryId === "string" &&
          typeof parsed.revisionId === "string"
        )
          initial = parsed;
      }
    } catch {
      setStorageWorks(false);
    }
    // Hydrate the tab-local draft only after mounting; never read browser storage on the server.
    setDraft(initial);
    setReady(true);
  }, [storageKey, entry?.body, entry?.entry_id, entry?.revision_id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!ready) return;
    const protect = (event: BeforeUnloadEvent) => {
      if (draft.body !== (entry?.body ?? "")) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [draft.body, ready, entry?.body]);
  function change(body: string) {
    const next = { ...draft, body, revisionId: crypto.randomUUID() };
    setDraft(next);
    setStatus("Not saved yet");
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setStorageWorks(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setStatus("Saving…");
    try {
      const result = await saveEntry({ seedId, ...draft });
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      setStatus("Saved");
      if (!entry)
        setDraft({
          body: "",
          entryId: crypto.randomUUID(),
          revisionId: crypto.randomUUID(),
          expectedRevisionId: null,
        });
      onSaved(draft.entryId);
    } catch {
      setStatus(
        "Connection interrupted. Your draft is still here. Retry when connected.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="writing-form" onSubmit={submit}>
      <label
        className="panel-kicker"
        htmlFor={`writing-${entry?.entry_id ?? "new"}`}
      >
        {entry ? "Revise this entry" : "New entry"}
      </label>
      <textarea
        id={`writing-${entry?.entry_id ?? "new"}`}
        aria-label={entry ? "Revise entry" : "New entry"}
        placeholder="A thought, a question, something you’re not ready to name…"
        value={draft.body}
        onChange={(e) => change(e.target.value)}
        disabled={!ready || pending}
        maxLength={20000}
        required
      />
      <div className="writing-footer">
        <button
          className="primary-button"
          disabled={!ready || pending || !draft.body.trim()}
        >
          {pending ? "Saving…" : entry ? "Save revision" : "Save entry"}
        </button>
        <span role="status" aria-live="polite">
          {status}
        </span>
      </div>
      <p className="form-note">
        {storageWorks
          ? "Unsaved writing stays in this tab when you revisit. Save before closing the tab."
          : "This browser cannot retain drafts. Keep this page open until saved."}{" "}
        AI stays outside your writing.
      </p>
    </form>
  );
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
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState(""),
    [settings, setSettings] = useState(false),
    [notice, setNotice] = useState(""),
    [savedEntry, setSavedEntry] = useState("");
  const garden = data.gardens.find((g) => g.id === data.gardenId);
  const requestedTopic = params.get("topic") ?? "";
  const requestedThought = params.get("thought") ?? "";
  const plotId = data.plots.find((p) => p.id === requestedTopic)?.id ?? "";
  const seedId =
    data.seeds.find((s) => s.id === requestedThought && s.plot_id === plotId)
      ?.id ?? "";
  const archived = params.get("view") === "archive";
  const invalidLocation =
    (!!requestedTopic && !plotId) ||
    (!!requestedThought && !seedId) ||
    (!!params.get("garden") && params.get("garden") !== data.gardenId);
  function navigate(topic = "", thought = "", archive = archived, entry = "") {
    const query = new URLSearchParams();
    if (data.gardenId) query.set("garden", data.gardenId);
    if (topic) query.set("topic", topic);
    if (thought) query.set("thought", thought);
    if (archive) query.set("view", "archive");
    window.history.pushState(
      null,
      "",
      `/garden?${query}${entry ? `#entry-${entry}` : ""}`,
    );
    setSearch("");
    setSavedEntry("");
  }
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
  useEffect(() => {
    const protectDrafts = (event: BeforeUnloadEvent) => {
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (
            key?.startsWith(`slow-garden:draft:v2:${data.tenantId}:`) &&
            JSON.parse(sessionStorage.getItem(key) ?? "{}").body
          ) {
            event.preventDefault();
            return;
          }
        }
      } catch {
        /* The editor separately warns if storage is unavailable. */
      }
    };
    window.addEventListener("beforeunload", protectDrafts);
    return () => window.removeEventListener("beforeunload", protectDrafts);
  }, [data.tenantId]);
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
        `Archive this ${label}? It will be hidden from active views, not deleted. Find it in Archive to restore it. Any unsaved draft stays in this tab.`,
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
        "Sign out and clear this tab’s unsaved drafts? Save any writing you want to keep first.",
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
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`slow-garden:draft:v2:${data.tenantId}:`))
        sessionStorage.removeItem(key);
    }
    router.replace("/login");
    router.refresh();
  }
  return (
    <main className="thinking-garden">
      <a className="skip-link" href="#garden-content">
        Skip to your thoughts
      </a>
      <header className="garden-top">
        <Link href={`/garden?garden=${data.gardenId}`} className="wordmark">
          Slow Garden<span className="wordmark-dot">✳</span>
        </Link>
        <nav aria-label="Garden tools">
          <button
            className="plain-button"
            onClick={() => setSettings(!settings)}
          >
            {settings ? "Close settings" : "Settings & export"}
          </button>
          <button
            className="plain-button"
            onClick={() => {
              navigate("", "", !archived);
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
          </div>
          <p>
            Exports include archived writing and every revision. Drafts remain
            in this browser tab until saved.
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
      <div className="garden-frame">
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

          {!garden ? (
            <div className="first-garden">
              <Plant />
              <h1>A place for what’s on your mind.</h1>
              <p>Name a garden. Leave room for the thoughts that follow.</p>
              <NewArea
                kind="garden"
                parentId=""
                onCreated={(id) => {
                  router.push(`/garden?garden=${id}`);
                  refresh();
                }}
              />
            </div>
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
                <Plant identity={seed.id} />
              </div>
              <a className="text-link" href="#saved-entries">
                View {entries.length} saved{" "}
                {entries.length === 1 ? "entry" : "entries"}
              </a>
              {seed.status === "active" &&
                garden.status === "active" &&
                !data.plots.find((p) => p.id === seed.plot_id)?.archived_at && (
                  <EntryEditor
                    key={`${data.gardenId}:${seed.id}`}
                    tenantId={data.tenantId}
                    seedId={seed.id}
                    onSaved={(id) => {
                      setNotice("Entry saved to this thought.");
                      setSavedEntry(id);
                      refresh();
                    }}
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
                <label className="search-field">
                  <span className="sr-only">Find a thought</span>
                  <input
                    type="search"
                    placeholder="Find a thought…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
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
                      <Plant identity={p.id} />
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
              <h2>{plot ? "Thoughts in this topic" : "All thoughts"}</h2>
              <div className="plant-grid" aria-label="Thoughts">
                {seeds.map((s) => (
                  <button
                    className="seed-plant"
                    key={s.id}
                    onClick={() => {
                      navigate(s.plot_id, s.id);
                    }}
                  >
                    <Plant identity={s.id} />
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
              </div>
              {seeds.length === 0 && (
                <p className="empty-garden-note">
                  {search
                    ? "No thoughts match this search."
                    : plot
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
                              false,
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
                  onContinue={setSeedId}
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
      <footer className="garden-foot">
        Yours to write. Yours to leave unfinished.
      </footer>
    </main>
  );
}
