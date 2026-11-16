"use client";
import { useState, type MouseEvent, type ReactNode } from "react";
import { useGardenStore } from "@/lib/garden/store/context";
import { exportPath } from "@/lib/garden/store/server-action-store";
import type { ExportFormat, ExportResult } from "@/lib/garden/store/types";

/** Hand a finished export to the browser as a download. */
export function saveExportFile(file: Extract<ExportResult, { ok: true }>) {
  const url = URL.createObjectURL(
    new Blob([file.text], { type: file.mimeType }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Let the download start before the object URL is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * An export link. On the server path it is the plain link it always was: the
 * browser follows it to the `/garden/export` route handler. On the browser
 * path the same link is answered by the store instead, which builds the same
 * file in this browser and saves it; nothing is requested from the app server.
 */
export function ExportLink({
  format,
  gardenId,
  className,
  onFailure,
  children,
}: {
  format: ExportFormat;
  gardenId?: string;
  className?: string;
  /** Browser path only: told the reason when no file could be produced. */
  onFailure?: (message: string) => void;
  children: ReactNode;
}) {
  const store = useGardenStore();
  const [busy, setBusy] = useState(false);
  async function save(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await store.exportGarden({ format, gardenId });
      if (result.ok) saveExportFile(result);
      else
        onFailure?.(
          result.reason === "signed-out"
            ? "Please sign in again to export."
            : result.reason === "unavailable"
              ? result.message
              : "Export failed; no partial export was produced.",
        );
    } catch {
      onFailure?.("Export failed; no partial export was produced.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <a
      className={className}
      href={exportPath({ format, gardenId })}
      aria-busy={busy || undefined}
      onClick={store.kind === "browser" ? save : undefined}
    >
      {children}
    </a>
  );
}
