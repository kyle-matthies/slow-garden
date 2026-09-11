const CONTINUATION_PREFIX = "slow-garden:continue:v1:";

function continuationKey(tenantId: string, seedId: string): string {
  return `${CONTINUATION_PREFIX}${tenantId}:${seedId}`;
}

/**
 * Queues text for the next new-entry editor opened on a thought. The editor
 * appends it to whatever draft it already holds, so queued continuations never
 * replace waiting writing and durable drafts never hide a requested continuation.
 * Returns false when the browser cannot hold the handoff.
 */
export function queueContinuation(
  storage: Storage | null,
  tenantId: string,
  seedId: string,
  text: string,
): boolean {
  if (!storage) return false;
  const key = continuationKey(tenantId, seedId);
  try {
    const existing = storage.getItem(key) ?? "";
    storage.setItem(key, existing ? `${existing}\n\n${text}` : text);
    return true;
  } catch {
    return false;
  }
}

/** Removes and returns queued continuation text, or null when none is waiting. */
export function takeContinuation(
  storage: Storage | null,
  tenantId: string,
  seedId: string,
): string | null {
  if (!storage) return null;
  const key = continuationKey(tenantId, seedId);
  try {
    const text = storage.getItem(key);
    if (text === null) return null;
    storage.removeItem(key);
    return text;
  } catch {
    return null;
  }
}

/** Joins a waiting draft body and a continuation without discarding either. */
export function appendContinuation(body: string, text: string): string {
  return body.trim() ? `${body.replace(/\s+$/, "")}\n\n${text}` : text;
}
