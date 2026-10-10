"use client";
import { useRef, useState, type FormEvent } from "react";
import { createArea } from "./actions";

export function NewArea({
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
