"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import type { Garden, Plot } from "@/lib/garden/types";
import {
  IMPORT_LIMITS,
  parseImportFile,
  type ImportedThought,
} from "@/lib/garden/import";
import { importThought } from "./actions";
import "./import.css";

type Preview = {
  key: string;
  thought: ImportedThought;
  title: string;
  include: boolean;
  status: string;
  attempted: boolean;
  imported: boolean;
  thoughtId?: string;
};
export function ImportForm({
  gardens,
  gardenId,
  plots,
}: {
  gardens: Garden[];
  gardenId: string;
  plots: Plot[];
}) {
  const router = useRouter();
  const [plotId, setPlotId] = useState(plots[0]?.id ?? "");
  const [files, setFiles] = useState<Preview[]>([]);
  const [notice, setNotice] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [reading, setReading] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [pending, startTransition] = useTransition();
  const previewGeneration = useRef(0);
  const inFlight = useRef(false);
  const busy = pending || reading || navigating;
  // A server navigation can replace the available topics. Never submit a stale id.
  const destination = plots.find((p) => p.id === plotId);

  useEffect(() => () => { previewGeneration.current++; }, []);

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? []);
    event.target.value = "";
    const generation = ++previewGeneration.current;
    setNotice("");
    if (list.length > IMPORT_LIMITS.maxFiles) {
      setNotice(`Choose up to ${IMPORT_LIMITS.maxFiles} files at once.`);
      setReading(false);
      return;
    }
    setReading(true);
    const next: Preview[] = [];
    for (const [index, file] of list.entries()) {
      const empty = {
        title: file.name,
        sourceName: file.name,
        hash: "",
        entries: [],
        warnings: [],
      };
      if (file.size > IMPORT_LIMITS.maxFileBytes) {
        next.push({
          key: `${generation}:${index}`,
          title: file.name,
          include: false,
          attempted: false,
          imported: false,
          status: `Skipped: files must stay under ${Math.round(
            IMPORT_LIMITS.maxFileBytes / 1000,
          )} KB.`,
          thought: empty,
        });
        continue;
      }
      try {
        const thought = await parseImportFile({
          name: file.name,
          text: await file.text(),
          lastModified: file.lastModified,
        });
        next.push({
          key: `${generation}:${index}`,
          thought,
          title: thought.title,
          include: thought.entries.length > 0,
          status: thought.entries.length ? "Ready to import" : "Skipped: no writing found.",
          attempted: false,
          imported: false,
        });
      } catch {
        next.push({
          key: `${generation}:${index}`,
          thought: empty,
          title: file.name,
          include: false,
          status: "Could not read this file. Choose it again to retry; your original file is unchanged.",
          attempted: false,
          imported: false,
        });
      }
      if (generation !== previewGeneration.current) return;
    }
    if (generation !== previewGeneration.current) return;
    setFiles(next);
    setReading(false);
  }

  function update(key: string, patch: Partial<Preview>) {
    setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  const selected = files.filter((f) => f.include && !f.imported && f.thought.entries.length);
  const invalidTitle = selected.some((f) => !f.title.trim() || f.title.trim().length > 160);
  const retryOnly = selected.length > 0 && selected.every((f) => f.attempted);
  const imported = files.filter((f) => f.imported);
  const failed = files.filter((f) => f.attempted && !f.imported);
  function submit() {
    if (inFlight.current || busy || !destination || !selected.length || invalidTitle) return;
    inFlight.current = true;
    setAttempted(true);
    startTransition(async () => {
      try {
        for (const file of selected) {
          update(file.key, { attempted: true, status: "Importing…" });
          try {
            const result = await importThought({
              plotId: destination.id,
              title: file.title,
              entries: file.thought.entries,
            });
            update(file.key, result.ok ? {
              imported: true,
              thoughtId: result.id,
              status: `Imported · ${result.created ?? 0} entries added, ${result.skipped ?? 0} already present`,
            } : { status: result.message });
          } catch {
            update(file.key, { status: "The connection was interrupted. Retry this thought safely; entries already saved will not be added twice." });
          }
        }
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <main className="import-page">
      <header className="import-top">
        <Link
          className="plain-button"
          href={`/garden?garden=${gardenId}`}
        >
          Back to garden
        </Link>
      </header>
      <h1>Bring in existing notes</h1>
      <p>
        Markdown or plain text works. Each file becomes one thought; dated
        headings such as <code>## 2024-03-05</code> become dated entries.
        Previewing happens in this browser. Nothing is uploaded or saved until
        you confirm. Retrying the same titles and destination safely skips entries
        already saved; your original files are never changed. Changing a title or
        destination starts a different import.
      </p>
      <p className="form-note">Previews show the first 200 characters of each entry; importing keeps the full text.</p>
      {invalidTitle && <p className="form-note" role="alert">Give each selected thought a title between 1 and 160 characters before importing.</p>}
      <label className="panel-kicker" htmlFor="import-garden">
        Garden
      </label>
      <select
        id="import-garden"
        value={gardenId}
        disabled={busy || attempted}
        onChange={(e) => {
          setNavigating(true);
          router.push(`/garden/import?garden=${encodeURIComponent(e.target.value)}`);
        }}
      >
        {gardens.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <label className="panel-kicker" htmlFor="import-plot">
        Topic
      </label>
      <select
        id="import-plot"
        value={destination ? plotId : ""}
        disabled={busy || attempted}
        onChange={(e) => setPlotId(e.target.value)}
      >
        <option value="" disabled>Choose a topic</option>
        {plots.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {!plots.length && <p>Create a topic in your garden before importing.</p>}
      <label className="panel-kicker" htmlFor="import-files">
        Files
      </label>
      <input
        id="import-files"
        type="file"
        multiple
        accept=".md,.markdown,.txt,text/plain,text/markdown"
        disabled={pending || attempted || navigating}
        onChange={onFiles}
      />
      <p className="form-note" role="status">
        {reading ? "Reading files for your preview…" : navigating ? "Opening the selected garden…" :
          `${selected.length} ${selected.length === 1 ? "thought" : "thoughts"} selected${destination ? ` for ${destination.name}` : "; choose an active topic"}.`}
      </p>
      {attempted && <p className="form-note">The destination and attempted titles stay fixed for safe retries. Start another import to choose a different destination or different files.</p>}
      <ul className="import-list">
        {files.map((f) => (
          <li key={f.key} className="import-card">
            <div className="import-include">
              <input
                type="checkbox"
                checked={f.include}
                aria-label={`Include ${f.thought.sourceName}`}
                disabled={pending || f.imported || !f.thought.entries.length}
                onChange={(e) => update(f.key, { include: e.target.checked })}
              />
              <input
                aria-label={`Title for ${f.thought.sourceName}`}
                className="import-title"
                value={f.title}
                maxLength={160}
                disabled={pending || f.attempted}
                onChange={(e) => update(f.key, { title: e.target.value })}
              />
            </div>
            <p className="form-note">
              {f.thought.sourceName} · {f.thought.entries.length}{" "}
              {f.thought.entries.length === 1 ? "entry" : "entries"}
            </p>
            {f.thought.warnings.map((w) => (
              <p key={w} className="form-note">
                {w}
              </p>
            ))}
            {f.thought.entries.map((e, i) => (
              <div key={i + e.hash} className="import-entry">
                <p className="form-note">
                  {e.date ?? "Undated · uses today"}
                </p>
                <pre>{e.body.slice(0, 200)}{e.body.length > 200 ? "…" : ""}</pre>
              </div>
            ))}
            <p role="status">{f.status}</p>
            {f.imported && f.thoughtId && (
              <Link className="text-link" href={`/garden?garden=${encodeURIComponent(gardenId)}&topic=${encodeURIComponent(plotId)}&thought=${encodeURIComponent(f.thoughtId)}`}>
                Open {f.title}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {attempted && !pending && (
        <p role="status" className="import-summary">
          {imported.length} {imported.length === 1 ? "thought" : "thoughts"} imported.
          {failed.length > 0 ? ` ${failed.length} ${failed.length === 1 ? "thought needs" : "thoughts need"} a retry. Successfully imported thoughts will not be retried.` : " All attempted thoughts are saved."}
        </p>
      )}
      <div className="action-row">
        <button
          className="primary-button"
          disabled={!destination || !selected.length || busy || invalidTitle}
          onClick={submit}
        >
          {pending
            ? "Importing…"
            : `${retryOnly ? "Retry" : "Import"} ${selected.length} ${
                selected.length === 1 ? "thought" : "thoughts"
              } into ${destination?.name ?? "topic"}`}
        </button>
        {imported.length > 0 && (
          <Link
            className="secondary-button"
            href={`/garden?garden=${gardenId}`}
          >
            Open garden
          </Link>
        )}
        {attempted && <button type="button" className="plain-button" disabled={pending} onClick={() => {
          setFiles([]);
          setAttempted(false);
          setNotice("");
        }}>Start another import</button>}
      </div>
      <p role="status">{notice}</p>
    </main>
  );
}
