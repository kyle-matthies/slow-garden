/**
 * A GardenStore that only writes to what is on screen (ADR-009 stage 2).
 *
 * In browser mode the garden is client state, so the page can outlive what it
 * shows: another garden may be loading, a load may have failed, or another tab
 * may have signed in as someone else. Every write is therefore checked first:
 *
 * - the session must still be the account the displayed data was read for;
 * - the garden, topic, thought, entry, pass, bloom or mark it names must be in
 *   the displayed data, or have been created through this store since (first
 *   run and "new garden" write into rows that have not been re-read yet).
 *
 * A refusal changes nothing and says so. This is a second line: the gate in
 * `browser-entry.tsx` already shows only the requested garden's data, and the
 * database (RLS, the RPCs) remains the authority. Reads are not checked,
 * except that Returns are read for the displayed garden only.
 */
import type { ActionResult, GardenData } from "../types";
import type { GardenStore } from "./types";

export const NOT_ON_SCREEN =
  "This is no longer the garden on screen, so nothing was saved. Reload the page, then try again.";
export const OTHER_ACCOUNT =
  "This page was opened by a different account, so nothing was saved. Reload the page to continue.";

export type GuardOptions = {
  /** The data being shown now, or null when no garden is on screen. */
  view: () => GardenData | null;
  /** Told when the session turned out to be another account's. */
  onOtherAccount?: () => void;
};

/**
 * Holds what is on screen for a guard, outside React state: the page tells it
 * after each render, and a write asks it at the moment it is made.
 */
export function createGuardView() {
  let shown: GardenData | null = null;
  let reload: () => void = () => {};
  return {
    show(data: GardenData | null, onOtherAccount: () => void) {
      shown = data;
      reload = onOtherAccount;
    },
    view: () => shown,
    onOtherAccount: () => reload(),
  };
}

export function guardStore(store: GardenStore, options: GuardOptions): GardenStore {
  /** Ids written through this store that a re-read has not shown yet. */
  const created = new Set<string>();
  /** Passes and blooms the Returns record showed for `returnsOf`. */
  const returned = new Set<string>();
  let returnsOf = "";
  let account = "";

  const refusal = (message: string): ActionResult => ({ ok: false, message });

  /** Null when the write may go ahead; otherwise why not. */
  async function refuse(allowed: (view: GardenData) => boolean): Promise<string | null> {
    const view = options.view();
    if (!view) return NOT_ON_SCREEN;
    if (account !== view.tenantId) {
      created.clear();
      returned.clear();
      returnsOf = "";
      account = view.tenantId;
    }
    const session = await store.getSession();
    // Signed out: the store's own "sign in again" answer is the right one.
    if (session.signedIn && session.tenantId !== view.tenantId) {
      options.onOtherAccount?.();
      return OTHER_ACCOUNT;
    }
    // The view may have changed while the session was read.
    const now = options.view();
    if (!now || now.tenantId !== view.tenantId) return NOT_ON_SCREEN;
    return allowed(now) ? null : NOT_ON_SCREEN;
  }

  const garden = (v: GardenData, id: string) =>
    (!!id && id === v.gardenId) || v.gardens.some((g) => g.id === id) || created.has(id);
  const shownGarden = (v: GardenData, id: string) => (!!id && id === v.gardenId) || created.has(id);
  const topic = (v: GardenData, id: string) => v.plots.some((p) => p.id === id) || created.has(id);
  const thought = (v: GardenData, id: string) => v.seeds.some((s) => s.id === id) || created.has(id);
  const entry = (v: GardenData, id: string) =>
    v.entries.some((e) => e.entry_id === id) || created.has(id);
  const pass = (v: GardenData, id: string) =>
    !!v.tendingHistory?.passes.some((p) => p.id === id) ||
    (returnsOf === v.gardenId && returned.has(id));
  const bloom = (v: GardenData, id: string) =>
    !!v.tending?.blooms.some((b) => b.id === id) ||
    (returnsOf === v.gardenId && returned.has(id));
  const mark = (v: GardenData, id: string) => !!v.tending?.marks.some((m) => m.id === id);
  const target = (v: GardenData, kind: string, id: string) =>
    kind === "garden"
      ? garden(v, id)
      : kind === "plot"
        ? topic(v, id)
        : kind === "seed"
          ? thought(v, id)
          : kind === "entry"
            ? entry(v, id)
            : kind === "account";

  return {
    ...store,

    async loadReturns(gardenId) {
      const view = options.view();
      if (!view || view.gardenId !== gardenId) throw new Error(NOT_ON_SCREEN);
      const result = await store.loadReturns(gardenId);
      if (returnsOf !== gardenId) returned.clear();
      returnsOf = gardenId;
      for (const row of [...result.passes, ...result.blooms]) returned.add(row.id);
      return result;
    },

    async createArea(kind, name, parentId, id) {
      const no = await refuse((v) =>
        kind === "garden" ? true : kind === "plot" ? shownGarden(v, parentId) : topic(v, parentId),
      );
      if (no) return refusal(no);
      const result = await store.createArea(kind, name, parentId, id);
      if (result.ok) created.add(result.id ?? id);
      return result;
    },
    async saveEntry(input) {
      const no = await refuse((v) => thought(v, input.seedId));
      if (no) return refusal(no);
      const result = await store.saveEntry(input);
      if (result.ok) created.add(input.entryId);
      return result;
    },
    async setArchived(kind, id, archived) {
      const no = await refuse((v) => target(v, kind, id));
      return no ? refusal(no) : store.setArchived(kind, id, archived);
    },
    async setTopicTending(topicId, ai, crossPollinate) {
      const no = await refuse((v) => topic(v, topicId));
      return no ? refusal(no) : store.setTopicTending(topicId, ai, crossPollinate);
    },
    async setTendingPreferences(tendOvernight, timezone) {
      const no = await refuse(() => true);
      return no ? refusal(no) : store.setTendingPreferences(tendOvernight, timezone);
    },
    async requestPass(gardenId, topicIds, id) {
      const no = await refuse(
        (v) => gardenId === v.gardenId && topicIds.every((t) => v.plots.some((p) => p.id === t)),
      );
      if (no) return refusal(no);
      const result = await store.requestPass(gardenId, topicIds, id);
      if (result.ok && returnsOf === gardenId) returned.add(id);
      return result;
    },
    async cancelPass(id) {
      const no = await refuse((v) => pass(v, id));
      return no ? refusal(no) : store.cancelPass(id);
    },
    async respondToBloom(id, bloomId, response, correction) {
      const no = await refuse((v) => bloom(v, bloomId));
      return no ? refusal(no) : store.respondToBloom(id, bloomId, response, correction);
    },
    async respondToMark(id, markId, response) {
      const no = await refuse((v) => mark(v, markId));
      return no ? refusal(no) : store.respondToMark(id, markId, response);
    },
    async importThought(input) {
      const no = await refuse((v) => topic(v, input.plotId));
      if (no) return refusal(no);
      const result = await store.importThought(input);
      if (result.ok && result.id) created.add(result.id);
      return result;
    },
    async previewDeletion(kind, id) {
      const no = await refuse((v) => target(v, kind, id));
      return no ? { ok: false, message: no } : store.previewDeletion(kind, id);
    },
    async deleteItem(kind, id, confirmName) {
      const no = await refuse((v) => target(v, kind, id));
      return no ? refusal(no) : store.deleteItem(kind, id, confirmName);
    },
    async deleteAccount(confirm) {
      const no = await refuse(() => true);
      return no ? { ok: false, message: no } : store.deleteAccount(confirm);
    },
  };
}
