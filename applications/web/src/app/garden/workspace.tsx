"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GardenData, Entry, ActionResult } from "@/lib/garden/types";
import { GardenReturns } from "./returns";
import {
  createArea,
  saveEntry,
  setArchived,
  setPlotPermissions,
  signOut,
} from "./actions";

function Plant({ variant = 0 }: { variant?: number }) {
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
        <g fill="#c59272">
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
        <path d="M65 32 Q41 17 59 6 Q84 10 65 32" fill="#759382" />
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
        ＋ {kind === "seed" ? "Plant a thought" : `New ${kind}`}
      </button>
    );
  return (
    <form className="new-area" onSubmit={submit}>
      <label htmlFor={`new-${kind}`}>
        {kind === "seed" ? "Name your thought" : `Name your ${kind}`}
      </label>
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
  onSaved: () => void;
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
      onSaved();
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
        {entry ? "Revise this entry" : "A little more room to think"}
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
}: {
  entry: Entry;
  tenantId: string;
  onRefresh: () => void;
  onArchive: () => void;
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
    <article className="journal-entry">
      <time dateTime={entry.created_at}>
        {new Date(entry.created_at).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </time>
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
        <button onClick={() => setEditing(!editing)} className="plain-button">
          {editing ? "Close editor" : "Revise"}
        </button>
        <button
          className="plain-button"
          onClick={() => (history ? setHistory(null) : viewHistory())}
        >
          {history ? "Close history" : "Revision history"}
        </button>
        <button className="plain-button" onClick={onArchive}>
          {entry.archived_at ? "Restore" : "Archive"}
        </button>
      </div>
      {history && (
        <ol className="revision-list" aria-label="Revision history">
          {history.map((r) => (
            <li key={r.id}>
              <time>{new Date(r.created_at).toLocaleString()}</time>
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
  const [plotId, setPlotId] = useState(""),
    [seedId, setSeedId] = useState(""),
    [search, setSearch] = useState(""),
    [archived, setArchivedView] = useState(false),
    [settings, setSettings] = useState(false),
    [notice, setNotice] = useState("");
  const garden = data.gardens.find((g) => g.id === data.gardenId);
  const plots = data.plots.filter((p) =>
    archived
      ? !!p.archived_at ||
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
  const entries = data.entries.filter(
    (e) =>
      e.seed_id === seedId &&
      (archived
        ? !!e.archived_at || seed?.status === "archived" || !!plot?.archived_at
        : !e.archived_at),
  );
  const seeds = data.seeds.filter(
    (s) =>
      (!plot || s.plot_id === plot.id) &&
      (archived
        ? s.status === "archived" ||
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
  async function mutation(action: () => Promise<ActionResult>) {
    try {
      const result = await action();
      setNotice(result.ok ? "Saved" : result.message);
      if (result.ok) refresh();
    } catch {
      setNotice("Could not save. Please retry.");
    }
  }
  async function leave() {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`slow-garden:draft:v2:${data.tenantId}:`))
        sessionStorage.removeItem(key);
    }
    await signOut();
  }
  return (
    <main className="thinking-garden">
      <a className="skip-link" href="#garden-content">
        Skip to your thoughts
      </a>
      <header className="garden-top">
        <Link href="/" className="wordmark">
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
              setPlotId("");
              setSeedId("");
              setArchivedView(!archived);
            }}
          >
            {archived ? "Back to growing" : "Resting thoughts"}
          </button>
        </nav>
      </header>
      {settings && (
        <section className="garden-settings">
          <h2>Your space, your control</h2>
          <p>
            Your writing is stored in your private account. AI is optional and
            each plot starts with it off.
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
          <button className="plain-button" onClick={leave}>
            Sign out on all devices and clear this tab’s drafts
          </button>
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
              setSeedId("");
              setPlotId("");
              router.push(`/garden?garden=${e.target.value}`);
            }}
          >
            {data.gardens.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.status === "archived" ? " · resting" : ""}
              </option>
            ))}
          </select>
          <button
            className="rail-link"
            aria-current={!plotId && !seedId ? "page" : undefined}
            onClick={() => {
              setPlotId("");
              setSeedId("");
            }}
          >
            All thoughts
          </button>
          <p className="panel-kicker">Your plots</p>
          {plots.map((p) => (
            <button
              className="rail-link"
              aria-current={plotId === p.id ? "page" : undefined}
              key={p.id}
              onClick={() => {
                setPlotId(p.id);
                setSeedId("");
                setSearch("");
              }}
            >
              <span aria-hidden="true">◌</span> {p.name}
              <small>
                {!p.ai_enabled
                  ? "AI off"
                  : p.cross_pollinate
                    ? "Cross-pollination on"
                    : "AI within this plot"}
              </small>
            </button>
          ))}
          {data.gardenId && (
            <NewArea
              kind="plot"
              parentId={data.gardenId}
              onCreated={(id) => {
                setPlotId(id);
                setSeedId("");
                refresh();
              }}
            />
          )}
          <details className="more-gardens">
            <summary>Another garden</summary>
            <NewArea
              kind="garden"
              parentId=""
              onCreated={(id) => {
                router.push(`/garden?garden=${id}`);
                setPlotId("");
                setSeedId("");
                refresh();
              }}
            />
          </details>
        </aside>
        <section
          id="garden-content"
          className={seed ? "thought-page" : "meadow-page"}
        >
          <div className="garden-breadcrumb">
            <span>YOUR PRIVATE THINKING GARDEN</span>
            <span>No hurry to become anything.</span>
          </div>
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
                  <p>Leave a fragment. Come back when you’re ready.</p>
                </div>
                <Plant />
              </div>
              {seed.status === "active" &&
                garden.status === "active" &&
                !data.plots.find((p) => p.id === seed.plot_id)?.archived_at && (
                  <EntryEditor
                    key={`${data.gardenId}:${seed.id}`}
                    tenantId={data.tenantId}
                    seedId={seed.id}
                    onSaved={refresh}
                  />
                )}
              <div className="journal-entries">
                {entries.map((e) => (
                  <EntryCard
                    key={e.entry_id}
                    entry={e}
                    tenantId={data.tenantId}
                    onRefresh={refresh}
                    onArchive={() =>
                      mutation(() =>
                        setArchived("entry", e.entry_id, !e.archived_at),
                      )
                    }
                  />
                ))}
              </div>
              <button
                className="plain-button"
                onClick={() =>
                  mutation(() =>
                    setArchived("seed", seed.id, seed.status === "active"),
                  )
                }
              >
                {seed.status === "archived"
                  ? "Restore this thought"
                  : "Let this thought rest"}
              </button>
            </>
          ) : (
            <>
              <div className="meadow-heading">
                <p className="panel-kicker">
                  {archived
                    ? "Rest is part of thinking"
                    : plot
                      ? "A living area for related thoughts"
                      : "A little space to be yourself"}
                </p>
                <h1>{plot?.name ?? garden.name}</h1>
                <p>
                  {plot
                    ? "Some thoughts take more than a single sitting."
                    : "Your questions and ideas can stay unfinished here."}
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
                {plot && !plot.archived_at && !archived && (
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
                  {plots.map((p, i) => (
                    <button
                      className="plot-card"
                      key={p.id}
                      onClick={() => setPlotId(p.id)}
                    >
                      <Plant variant={i} />
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
              <div className="plant-grid" aria-label="Thoughts">
                {seeds.map((s, i) => (
                  <button
                    className="seed-plant"
                    key={s.id}
                    onClick={() => {
                      setPlotId(s.plot_id);
                      setSeedId(s.id);
                    }}
                  >
                    <Plant variant={i} />
                    <span className="plant-label">{s.title}</span>
                    <small>
                      {data.plots.find((p) => p.id === s.plot_id)?.name}
                    </small>
                  </button>
                ))}
              </div>
              {seeds.length === 0 && (
                <p className="empty-garden-note">
                  {search
                    ? "No thoughts match this search."
                    : plot
                      ? "Plant a named thought here. Add to it whenever something comes to you."
                      : "Start with a plot for a question, a project, or a corner of your life."}
                </p>
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
                    Plot controls ·{" "}
                    {!plot.ai_enabled
                      ? "AI off"
                      : plot.cross_pollinate
                        ? "Cross-pollination on"
                        : "AI isolated to this plot"}
                  </summary>
                  <p>
                    AI tending is optional. Cross-pollination lets this plot
                    exchange context with other participating plots in this
                    garden.
                  </p>
                  <label>
                    <input
                      type="checkbox"
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
                      disabled={!plot.ai_enabled}
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
                      ? "This plot’s writing and insights stay isolated from other plots."
                      : "Every participating plot must give its own permission."}
                  </p>
                  <p>
                    Permissions never trigger processing by themselves. Invite
                    AI separately when you want a reflection.
                  </p>
                  <button
                    className="plain-button"
                    onClick={() =>
                      mutation(() =>
                        setArchived("plot", plot.id, !plot.archived_at),
                      )
                    }
                  >
                    {plot.archived_at ? "Restore plot" : "Let this plot rest"}
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
