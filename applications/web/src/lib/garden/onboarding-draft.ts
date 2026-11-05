import {
  draftsClearedSince,
  ensureTabIdentity,
  LIVE_TABS_KEY,
  openDraftStore,
  TAB_STALE_MS,
  type DraftBackend,
  type DraftRecord,
} from "./drafts";

const SEED = "first-run-onboarding";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type OnboardingDraft = {
  version: 1;
  completed: boolean;
  step: number;
  gardenId: string;
  topicId: string;
  thoughtId: string;
  gardenName: string;
  topicName: string;
  thoughtTitle: string;
  body: string;
  starters: string[];
  gardenRequestId: string;
  topicRequestId: string;
  thoughtRequestId: string;
  starterIds: Record<string, string>;
  entryId: string;
  revisionId: string;
};

export const emptyOnboardingDraft = (): OnboardingDraft => ({
  version: 1, completed: false, step: 1, gardenId: "", topicId: "", thoughtId: "",
  gardenName: "", topicName: "", thoughtTitle: "", body: "", starters: [],
  gardenRequestId: "", topicRequestId: "", thoughtRequestId: "", starterIds: {},
  entryId: "", revisionId: "",
});

export function parseOnboardingDraft(value: string): OnboardingDraft | null {
  try {
    const d = JSON.parse(value) as OnboardingDraft;
    if (!d || d.version !== 1 || typeof d.completed !== "boolean" || !Number.isInteger(d.step) || d.step < 1 || d.step > 4) return null;
    for (const k of ["gardenName", "topicName", "thoughtTitle", "body"] as const)
      if (typeof d[k] !== "string" || d[k].length > (k === "body" ? 20000 : k === "thoughtTitle" ? 160 : 120)) return null;
    for (const k of ["gardenId", "topicId", "thoughtId", "gardenRequestId", "topicRequestId", "thoughtRequestId", "entryId", "revisionId"] as const)
      if (typeof d[k] !== "string" || (d[k] !== "" && !uuid.test(d[k]))) return null;
    if ((d.step >= 2 && !d.gardenId) || (d.step >= 3 && !d.topicId) || (d.step === 4 && !d.thoughtId)) return null;
    if (!Array.isArray(d.starters) || d.starters.some((s) => !["Reading", "Work", "Questions"].includes(s))) return null;
    if (!d.starterIds || typeof d.starterIds !== "object" || Array.isArray(d.starterIds) || Object.entries(d.starterIds).some(([k, v]) => !["Reading", "Work", "Questions"].includes(k) || typeof v !== "string" || !uuid.test(v))) return null;
    return d;
  } catch { return null; }
}

function safeLocal() {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

function currentTab() {
  let session: Storage | null = null;
  try { session = window.sessionStorage; } catch {}
  return ensureTabIdentity({ sessionStorage: session, localStorage: safeLocal() });
}

function liveElsewhere(tabId: string) {
  try {
    const tabs = JSON.parse(safeLocal()?.getItem(LIVE_TABS_KEY) ?? "{}");
    return typeof tabs?.[tabId] === "number" && tabs[tabId] >= Date.now() - TAB_STALE_MS;
  } catch { return false; }
}

export type OnboardingRecovery = { state: OnboardingDraft; record: DraftRecord };

/** Used by the workspace to resume setup even after its first garden was saved. */
export async function loadOnboardingDraft(
  tenantId: string,
  backend?: DraftBackend | null,
  strict = false,
  tabId = currentTab(),
): Promise<OnboardingRecovery | null> {
  try {
    const store = backend === undefined ? await openDraftStore() : backend;
    const rows = await store?.list(tenantId) ?? [];
    const valid: OnboardingRecovery[] = [];
    for (const record of [...rows].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (record.tenantId !== tenantId || record.seedId !== SEED) continue;
      if (draftsClearedSince(safeLocal(), tenantId, record.updatedAt)) continue;
      const state = parseOnboardingDraft(record.body);
      if (state) valid.push({ state, record });
    }
    // A completion belongs only to its own tab. It must never hide a different
    // tab's unfinished writing, even if the other tab has not typed recently.
    const own = valid.find(({ record }) => record.tabId === tabId);
    if (own) return own.state.completed ? null : own;
    return valid.find(({ state, record }) => !state.completed && !liveElsewhere(record.tabId)) ?? null;
  } catch (error) { if (strict) throw error; }
  return null;
}

export function onboardingRecord(tenantId: string, tabId: string, state: OnboardingDraft): DraftRecord {
  return {
    key: `${tenantId}:${SEED}:${tabId}`, tenantId, seedId: SEED, entryId: "onboarding",
    scope: "new", body: JSON.stringify(state), revisionId: state.revisionId,
    expectedRevisionId: null, baseBody: "", updatedAt: Date.now(), tabId,
  };
}
