"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Secondary garden tools. Inline on wide screens; on phones they fold behind a
 * "More" disclosure so the header stays one row above the scene.
 */
export function ToolsMenu({
  children,
}: {
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className="tools-menu" data-open={open || undefined}>
      <button
        ref={toggle}
        type="button"
        className="plain-button tools-more"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        More
      </button>
      <div id={id} className="tools-secondary">
        {children(() => setOpen(false))}
      </div>
    </div>
  );
}
