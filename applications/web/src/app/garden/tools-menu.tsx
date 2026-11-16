"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { NavGlyph } from "./level-nav";

/**
 * The one account and settings menu: export, import, archive and sign out live
 * here at every width, so the navigation only carries places to go. On a
 * phone it is the last item of the bottom bar and opens upward as a sheet.
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
        <NavGlyph name="more" />
        <span>More</span>
        <span className="tools-more-caret" aria-hidden="true">▾</span>
      </button>
      <div id={id} className="tools-secondary">
        {children(() => setOpen(false))}
      </div>
    </div>
  );
}
