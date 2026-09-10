"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ChangeEvent } from "react";
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
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? []);
    event.target.value = "";
    setNotice("");
    setDone(false);
    if (list.length > IMPORT_LIMITS.maxFiles) {
      setNotice(`Choose up to ${IMPORT_LIMITS.maxFiles} files at once.`);
      return;
    }
    const next: Preview[] = [];
    for (const file of list) {
      if (file.size > IMPORT_LIMITS.maxFileBytes) {
        next.push({
          key: file.name,
          title: file.name,
          include: false,
          status: `Skipped: files must stay under ${Math.round(
            IMPORT_LIMITS.maxFileBytes / 1000,
          )} KB.`,
          thought: {
            title: file.name,
            sourceName: file.name,
            hash: "",
            entries: [],
            warnings: [],
          },
        });
        continue;
      }
      const thought = await parseImportFile({
        name: file.name,
        text: await file.text(),
        lastModified: file.lastModified,
      });
      next.push({
        key: file.name + ":" + file.lastModified,
        thought,
        title: thought.title,
        include: thought.entries.length > 0,
        status: "",
      });
    }
    setFiles(next);
  }

  function update(key: string, patch: Partial<Preview>) {
    setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  const selected = files.filter((f) => f.include && f.thought.entries.length);
  function submit() {
    startTransition(async () => {
      for (const file of selected) {
        update(file.key, { status: "Importing…" });
        const result = await importThought({
          plotId,
          title: file.title,
          entries: file.thought.entries,
        });
        update(file.key, {
          status: result.ok
            ? `Imported · ${result.created ?? 0} entries added, ${
                result.skipped ?? 0
              } already present`
            : result.message,
        });
      }
      setDone(true);
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
        Nothing is saved until you confirm, and importing the same file twice
        adds nothing.
      </p>
      <label className="panel-kicker" htmlFor="import-garden">
        Garden
      </label>
      <select
        id="import-garden"
        value={gardenId}
        onChange={(e) => router.push(`/garden/import?garden=${e.target.value}`)}
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
        value={plotId}
        onChange={(e) => setPlotId(e.target.value)}
      >
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
        onChange={onFiles}
      />
      <ul className="import-list">
        {files.map((f) => (
          <li key={f.key} className="import-card">
            <label className="import-include">
              <input
                type="checkbox"
                checked={f.include}
                disabled={!f.thought.entries.length}
                onChange={(e) => update(f.key, { include: e.target.checked })}
              />
              <input
                aria-label={`Title for ${f.thought.sourceName}`}
                className="import-title"
                value={f.title}
                maxLength={160}
                onChange={(e) => update(f.key, { title: e.target.value })}
              />
            </label>
            <p className="form-note">
              {f.thought.sourceName} · {f.thought.entries.length}{" "}
              {f.thought.entries.length === 1 ? "entry" : "entries"}
            </p>
            {f.thought.warnings.map((w) => (
              <p key={w} className="form-note">
                {w}
              </p>
            ))}
            {f.thought.entries.map((e) => (
              <div key={e.hash} className="import-entry">
                <p className="form-note">
                  {e.date ?? "Undated · uses today"}
                </p>
                <pre>{e.body.slice(0, 200)}</pre>
              </div>
            ))}
            <p role="status">{f.status}</p>
          </li>
        ))}
      </ul>
      <div className="action-row">
        <button
          className="primary-button"
          disabled={!plotId || !selected.length || pending}
          onClick={submit}
        >
          {pending
            ? "Importing…"
            : `Import ${selected.length} ${
                selected.length === 1 ? "thought" : "thoughts"
              } into ${plots.find((p) => p.id === plotId)?.name ?? "topic"}`}
        </button>
        {done && (
          <Link
            className="secondary-button"
            href={`/garden?garden=${gardenId}`}
          >
            Open garden
          </Link>
        )}
      </div>
      <p role="status">{notice}</p>
    </main>
  );
}
