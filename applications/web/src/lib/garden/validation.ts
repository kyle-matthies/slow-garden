export function validateAreaName(
  kind: "garden" | "plot" | "seed",
  name: string,
): string | null {
  return !name.trim() || name.length > (kind === "seed" ? 160 : 120)
    ? "Please choose a short name."
    : null;
}

export function validateEntryBody(body: string): string | null {
  return !body.trim() || body.length > 20000
    ? "Write between 1 and 20,000 characters."
    : null;
}

export function validateBloomResponse(
  response: "keep" | "correct" | "prune",
  correction: string,
): string | null {
  return response === "correct" && !correction.trim()
    ? "Add your correction in your own words."
    : null;
}

export function saveErrorMessage(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string };
  return e.code === "40001"
    ? "This entry changed elsewhere. Reload to review it; your draft is still here."
    : "Could not save. Your writing is still here; please retry.";
}
