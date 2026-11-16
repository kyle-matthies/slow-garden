"use client";
import { useEffect, useId, useRef, useState } from "react";
import "./delete-control.css";
import {
  deleteAccount,
  deleteItem,
  previewDeletion,
  type DeletionCounts,
  type DeletionKind,
} from "./actions";
import { DeleteReauth } from "./delete-reauth";

const NOUN: Record<DeletionKind, string> = {
  entry: "entry",
  seed: "thought",
  plot: "topic",
  garden: "garden",
  account: "account",
};
/** Topic, garden and account are confirmed by typing a name; entry and thought by a plain confirm. */
const TYPED: readonly DeletionKind[] = ["plot", "garden", "account"];

function count(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
/** The exact list of what goes, in plain words, from the database's own counts. */
export function erasedLines(kind: DeletionKind, c: DeletionCounts): string[] {
  const lines: string[] = [];
  if (kind === "account") lines.push(count(c.gardens, "garden"));
  if (kind === "garden" || kind === "account")
    lines.push(count(c.topics, "topic"));
  if (kind !== "entry" && kind !== "seed") lines.push(count(c.thoughts, "thought"));
  if (kind === "seed") lines.push("This thought and its title");
  lines.push(
    kind === "entry"
      ? `This entry, with ${count(c.versions, "saved version")}`
      : `${count(c.entries, "entry", "entries")}, with ${count(c.versions, "saved version")}`,
  );
  if (c.returns > 0)
    lines.push(
      `${count(c.returns, "bloom")} from tending that read this writing`,
    );
  if (c.responses > 0)
    lines.push(
      `${count(c.responses, "response")} you gave to ${c.returns === 1 ? "that bloom" : "those blooms"} (kept, corrected or pruned)`,
    );
  if (c.marks > 0)
    lines.push(`${count(c.marks, "tending mark")} from the same tending`);
  if (kind === "account")
    lines.push("Your account and sign-in, on every device");
  return lines;
}

type Props = {
  /** Deletion is switched on for this deployment (GardenData.deletionAvailable). */
  enabled: boolean;
  kind: DeletionKind;
  /** Row id; ignored for an account. */
  id: string;
  /** The item's own name: shown in the heading and typed back for topic and garden. */
  name: string;
  /** Garden whose export to offer first (garden deletion). */
  exportGardenId?: string;
  disabled?: boolean;
  /** Called after the database confirms the deletion. */
  onDeleted: () => void | Promise<void>;
};

/**
 * Permanent deletion, beside archive and unmistakably not archive.
 * A native modal dialog: focus is held inside it, Escape cancels, and focus
 * returns to the button that opened it.
 */
export function DeleteControl(props: Props) {
  // Off: nothing about deletion is rendered at all.
  return props.enabled ? <DeleteDialogControl {...props} /> : null;
}

function DeleteDialogControl({
  kind,
  id,
  name,
  exportGardenId,
  disabled = false,
  onDeleted,
}: Omit<Props, "enabled">) {
  const noun = NOUN[kind];
  const typed = TYPED.includes(kind);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<DeletionCounts | null>(null);
  const [phrase, setPhrase] = useState(kind === "account" ? "" : name);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!open) return;
    const node = dialog.current;
    if (node && !node.open) {
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    }
    // The safe choice holds focus first; a typed confirmation starts in its field.
    (typed ? field.current : cancel.current)?.focus();
    let current = true;
    previewDeletion(kind, id).then(
      (result) => {
        if (!current) return;
        if (result.ok) {
          setCounts(result.counts);
          if (result.confirmPhrase) setPhrase(result.confirmPhrase);
        } else setError(result.message);
      },
      () => {
        if (current)
          setError("Could not count what this would erase. Nothing was erased.");
      },
    );
    return () => {
      current = false;
    };
  }, [open, kind, id, typed]);

  function close() {
    if (busy) return;
    const node = dialog.current;
    if (node?.open && typeof node.close === "function") node.close();
    else node?.removeAttribute("open");
    setOpen(false);
    setCounts(null);
    setValue("");
    setError("");
    setReauth(false);
    setSignedIn(false);
    trigger.current?.focus();
  }
  const matches =
    !typed ||
    (kind === "account"
      ? phrase !== "" && value.trim().toLowerCase() === phrase.toLowerCase()
      : value.trim() === phrase.trim());
  const ready = !!counts && matches && !busy && !reauth;

  async function erase() {
    if (!ready) return;
    setBusy(true);
    setError("");
    let result;
    try {
      result =
        kind === "account"
          ? await deleteAccount(value)
          : await deleteItem(kind, id, typed ? value : "");
    } catch {
      result = {
        ok: false as const,
        message: "Could not reach the garden. Nothing was erased; please retry.",
      };
    }
    if (!result.ok) {
      setBusy(false);
      if ("reauth" in result && result.reauth) {
        setSignedIn(false);
        setReauth(true);
      } else setError(result.message);
      return;
    }
    const node = dialog.current;
    if (node?.open && typeof node.close === "function") node.close();
    setBusy(false);
    setOpen(false);
    await onDeleted();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="plain-button delete-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Delete {noun}…
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="delete-dialog"
          aria-labelledby={titleId}
          aria-describedby={noteId}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <form
            method="dialog"
            onSubmit={(event) => {
              event.preventDefault();
              erase();
            }}
          >
            <h2 id={titleId}>
              {kind === "account"
                ? "Delete your account permanently?"
                : kind === "entry"
                  ? "Delete this entry permanently?"
                  : `Delete “${name}” permanently?`}
            </h2>
            <p id={noteId} className="delete-distinction">
              Archive hides. Delete erases, permanently.
            </p>
            <div className="delete-scope" aria-live="polite">
              {counts ? (
                <>
                  <p>This will erase:</p>
                  <ul>
                    {erasedLines(kind, counts).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : (
                !error && <p>Counting what this will erase…</p>
              )}
            </div>
            <p className="delete-fine">
              It cannot be restored from Archive or by us. Unsaved drafts of
              it in this browser are discarded. Copies inside our database
              provider’s routine backups are not reachable from the app and
              expire on the provider’s schedule.
            </p>
            {(kind === "garden" || kind === "account") && (
              <p className="delete-export">
                Want a copy?{" "}
                <a
                  href={
                    kind === "garden" && exportGardenId
                      ? `/garden/export?format=md&garden=${exportGardenId}`
                      : "/garden/export?format=md"
                  }
                >
                  Export first · Markdown
                </a>{" "}
                <a
                  href={
                    kind === "garden" && exportGardenId
                      ? `/garden/export?garden=${exportGardenId}`
                      : "/garden/export"
                  }
                >
                  Export first · JSON
                </a>
              </p>
            )}
            {typed && (
              <label className="delete-confirm">
                <span>
                  {kind === "account" ? (
                    phrase ? (
                      <>
                        Type <strong>{phrase}</strong> to confirm
                      </>
                    ) : (
                      "Type your email address to confirm"
                    )
                  ) : (
                    <>
                      Type <strong>{phrase}</strong> to confirm
                    </>
                  )}
                </span>
                <input
                  ref={field}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </label>
            )}
            {reauth && (
              <DeleteReauth
                email={phrase.includes("@") ? phrase : ""}
                onDone={() => {
                  setReauth(false);
                  setSignedIn(true);
                  field.current?.focus();
                }}
              />
            )}
            <p role="status" className="delete-reauth-status">
              {signedIn
                ? "You are signed in again. You can delete your account now."
                : ""}
            </p>
            <p role="alert" className="delete-error">
              {error}
            </p>
            <div className="delete-actions">
              <button
                ref={cancel}
                type="button"
                className="secondary-button"
                onClick={close}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="delete-confirm-button" disabled={!ready}>
                {busy ? "Deleting…" : `Delete ${noun} permanently`}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
