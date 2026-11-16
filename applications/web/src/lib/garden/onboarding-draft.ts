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
/** Sensible starting names so the first screen can begin with writing. */
export const DEFAULT_GARDEN_NAME = "My garden";
export const DEFAULT_TOPIC_NAME = "Notes";

/**
 * A thought needs a title. When the person has not given one, use the opening
 * of their own first line, unaltered apart from trimming to a short length.
 */
export function titleFromFirstLine(body: string, limit = 60): string {
  const line = body.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  if (!line) return "First thought";
  if (line.length <= limit) return line;
  const cut = line.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The person's optional background is kept as an ordinary thought with this title. */
export const BACKGROUND_THOUGHT_TITLE = "What I’m tending";

/** A starting topic taken from a seed pack. Its name is copied so recovery never depends on the catalog. */
export type OnboardingBed = {
  /** `<pack id>/<index>`: stable identity inside the draft. */
  key: string;
  name: string;
  /** Ticked: will be created on save. */
  on: boolean;
  requestId: string;
  /** Set once the topic has been saved. */
  id: string;
};

export type OnboardingDraft = {
  version: 2;
  completed: boolean;
  step: number;
  gardenId: string;
  /** The person's own topic ("Notes" unless renamed). */
  topicId: string;
  thoughtId: string;
  gardenName: string;
  topicName: string;
  thoughtTitle: string;
  body: string;
  gardenRequestId: string;
  topicRequestId: string;
  thoughtRequestId: string;
  entryId: string;
  revisionId: string;
  entrySaved: boolean;
  /** Seed packs the person opened, and the topics they kept from them. */
  packs: string[];
  beds: OnboardingBed[];
  /** Key of the bed the first page is written in; "" means the person's own topic. */
  writeIn: string;
  /** Optional background, saved as the person's own thought in a "Notes" topic. */
  background: string;
  notesRequestId: string;
  notesId: string;
  tendingRequestId: string;
  tendingThoughtId: string;
  tendingEntryId: string;
  tendingRevisionId: string;
};

export const emptyOnboardingDraft = (): OnboardingDraft => ({
  version: 2, completed: false, step: 1, gardenId: "", topicId: "", thoughtId: "",
  gardenName: DEFAULT_GARDEN_NAME, topicName: DEFAULT_TOPIC_NAME, thoughtTitle: "", body: "",
  gardenRequestId: "", topicRequestId: "", thoughtRequestId: "",
  entryId: "", revisionId: "", entrySaved: false,
  packs: [], beds: [], writeIn: "",
  background: "", notesRequestId: "", notesId: "",
  tendingRequestId: "", tendingThoughtId: "", tendingEntryId: "", tendingRevisionId: "",
});

const LEGACY_STARTERS = ["Reading", "Work", "Questions"];
const packId = /^[a-z0-9-]{1,40}$/;
const bedKey = /^[a-z0-9-]{1,40}\/\d{1,2}$/;
const idOrBlank = (v: unknown) => typeof v === "string" && (v === "" || uuid.test(v));

/** Reads the current shape, and upgrades a version 1 checkpoint written before seed packs existed. */
export function parseOnboardingDraft(value: string): OnboardingDraft | null {
  try {
    const raw = JSON.parse(value) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object" || (raw.version !== 1 && raw.version !== 2)) return null;
    let d: OnboardingDraft;
    if (raw.version === 1) {
      const { starters, starterIds, ...rest } = raw;
      if (!Array.isArray(starters) || starters.some((s) => !LEGACY_STARTERS.includes(s))) return null;
      if (!starterIds || typeof starterIds !== "object" || Array.isArray(starterIds) || Object.entries(starterIds).some(([k, v]) => !LEGACY_STARTERS.includes(k) || typeof v !== "string" || !uuid.test(v))) return null;
      // The old starter chips were never created as topics; nothing to carry over.
      d = { ...emptyOnboardingDraft(), ...rest, version: 2 } as OnboardingDraft;
    } else d = raw as unknown as OnboardingDraft;
    if (typeof d.completed !== "boolean" || typeof d.entrySaved !== "boolean" || !Number.isInteger(d.step) || d.step < 1 || d.step > 4) return null;
    for (const k of ["gardenName", "topicName", "thoughtTitle", "body", "background"] as const)
      if (typeof d[k] !== "string" || d[k].length > (k === "body" || k === "background" ? 20000 : k === "thoughtTitle" ? 160 : 120)) return null;
    for (const k of ["gardenId", "topicId", "thoughtId", "gardenRequestId", "topicRequestId", "thoughtRequestId", "entryId", "revisionId", "notesRequestId", "notesId", "tendingRequestId", "tendingThoughtId", "tendingEntryId", "tendingRevisionId"] as const)
      if (!idOrBlank(d[k])) return null;
    if (!Array.isArray(d.packs) || d.packs.length > 24 || d.packs.some((p) => typeof p !== "string" || !packId.test(p))) return null;
    if (!Array.isArray(d.beds) || d.beds.length > 96) return null;
    for (const b of d.beds)
      if (!b || typeof b !== "object" || typeof b.key !== "string" || !bedKey.test(b.key) || typeof b.name !== "string" || !b.name.trim() || b.name.length > 120 || typeof b.on !== "boolean" || !idOrBlank(b.requestId) || !idOrBlank(b.id)) return null;
    if (new Set(d.beds.map((b) => b.key)).size !== d.beds.length) return null;
    if (typeof d.writeIn !== "string" || (d.writeIn !== "" && !d.beds.some((b) => b.key === d.writeIn))) return null;
    const anyTopic = !!d.topicId || !!d.notesId || d.beds.some((b) => b.id);
    if ((d.step >= 2 && !d.gardenId) || (d.step >= 3 && !anyTopic) || (d.step === 4 && !d.thoughtId)) return null;
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
