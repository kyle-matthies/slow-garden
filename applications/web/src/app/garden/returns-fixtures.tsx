import type { Entry, GardenData, Plot, Seed } from "@/lib/garden/types";
import type {
  CabinetBloom,
  CabinetPass,
  CabinetResponse,
} from "./returns-cabinet";

/**
 * Synthetic fixtures only. Nothing here is real journal content; the prose is
 * invented for reviewing every pass and bloom state without a provider.
 */
export const FIXTURE_TENANT = "00000000-0000-4000-8000-00000000f1de";
export const FIXTURE_GARDEN = "00000000-0000-4000-8000-0000000000a1";
const PLOT_A = "00000000-0000-4000-8000-0000000000b1";
const PLOT_B = "00000000-0000-4000-8000-0000000000b2";
const SEED_1 = "00000000-0000-4000-8000-0000000000c1";
const SEED_2 = "00000000-0000-4000-8000-0000000000c2";
const ENTRY_1 = "00000000-0000-4000-8000-0000000000d1";
const ENTRY_2 = "00000000-0000-4000-8000-0000000000d2";
const ENTRY_3 = "00000000-0000-4000-8000-0000000000d3";
const REV_1 = "00000000-0000-4000-8000-0000000000e1";
const REV_2_OLD = "00000000-0000-4000-8000-0000000000e2";
const REV_2_NEW = "00000000-0000-4000-8000-0000000000e3";
const REV_3 = "00000000-0000-4000-8000-0000000000e4";
const REV_GONE = "00000000-0000-4000-8000-0000000000e9";

export const fixturePlots: Plot[] = [
  {
    id: PLOT_A,
    garden_id: FIXTURE_GARDEN,
    name: "Fixture topic · walking",
    ai_enabled: true,
    cross_pollinate: false,
    archived_at: null,
    permission_version: 1,
  },
  {
    id: PLOT_B,
    garden_id: FIXTURE_GARDEN,
    name: "Fixture topic · lamps",
    ai_enabled: true,
    cross_pollinate: false,
    archived_at: null,
    permission_version: 1,
  },
];
export const fixtureSeeds: Seed[] = [
  {
    id: SEED_1,
    garden_id: FIXTURE_GARDEN,
    plot_id: PLOT_A,
    title: "Why the long route feels shorter",
    status: "active",
    created_at: "2026-08-30T08:00:00Z",
  },
  {
    id: SEED_2,
    garden_id: FIXTURE_GARDEN,
    plot_id: PLOT_B,
    title: "Lamp inventory",
    status: "active",
    created_at: "2026-08-31T08:00:00Z",
  },
];
export const fixtureEntries: Entry[] = [
  {
    entry_id: ENTRY_1,
    revision_id: REV_1,
    seed_id: SEED_1,
    body: "Took the canal path again instead of the road. It is eleven minutes longer by the watch and somehow arrives sooner in the head. I keep noticing the same heron.",
    revision_number: 1,
    created_at: "2026-09-01T07:10:00Z",
    revised_at: "2026-09-01T07:10:00Z",
    archived_at: null,
  },
  {
    entry_id: ENTRY_2,
    revision_id: REV_2_NEW,
    seed_id: SEED_1,
    body: "Rewrote this: the short route is all waiting at crossings. The long route is all moving. Maybe it is not distance I mind but standing still.",
    revision_number: 2,
    created_at: "2026-09-03T18:40:00Z",
    revised_at: "2026-09-06T09:00:00Z",
    archived_at: null,
  },
  {
    entry_id: ENTRY_3,
    revision_id: REV_3,
    seed_id: SEED_2,
    body: "Counted the lamps: four in the front room, one that has never worked. Kept it anyway.",
    revision_number: 1,
    created_at: "2026-09-02T21:00:00Z",
    revised_at: "2026-09-02T21:00:00Z",
    archived_at: "2026-09-07T10:00:00Z",
  },
];
/** Superseded revisions the live app resolves via `seed_revisions`; fixtures resolve them here. */
export const fixtureRevisionIndex: Record<
  string,
  { entry_id: string; seed_id: string; revision_number: number; created_at: string }
> = {
  [REV_2_OLD]: {
    entry_id: ENTRY_2,
    seed_id: SEED_1,
    revision_number: 1,
    created_at: "2026-09-03T18:40:00Z",
  },
};

export const fixtureGarden: GardenData = {
  tenantId: FIXTURE_TENANT,
  gardens: [{ id: FIXTURE_GARDEN, name: "Fixture garden", status: "active" }],
  gardenId: FIXTURE_GARDEN,
  plots: fixturePlots,
  seeds: fixtureSeeds,
  entries: fixtureEntries,
  aiAvailable: false,
};

const P = {
  queued: "00000000-0000-4000-8000-000000000101",
  processing: "00000000-0000-4000-8000-000000000102",
  completeEmpty: "00000000-0000-4000-8000-000000000103",
  completeOne: "00000000-0000-4000-8000-000000000104",
  completeThree: "00000000-0000-4000-8000-000000000105",
  failed: "00000000-0000-4000-8000-000000000106",
  cancelled: "00000000-0000-4000-8000-000000000107",
  withdrawn: "00000000-0000-4000-8000-000000000108",
};
const B = {
  fresh: "00000000-0000-4000-8000-000000000201",
  kept: "00000000-0000-4000-8000-000000000202",
  corrected: "00000000-0000-4000-8000-000000000203",
  pruned: "00000000-0000-4000-8000-000000000204",
  gone: "00000000-0000-4000-8000-000000000205",
};

export const fixturePasses: CabinetPass[] = [
  {
    id: P.queued,
    status: "queued",
    created_at: "2026-09-09T06:00:00Z",
    finished_at: null,
    no_output_reason: null,
    plot_ids: [PLOT_A],
  },
  {
    id: P.processing,
    status: "processing",
    created_at: "2026-09-08T22:00:00Z",
    finished_at: null,
    no_output_reason: null,
    plot_ids: [PLOT_A],
  },
  {
    id: P.completeEmpty,
    status: "complete",
    created_at: "2026-09-08T06:00:00Z",
    finished_at: "2026-09-08T09:00:00Z",
    no_output_reason: "No new reflection this time. Your thoughts can rest.",
    plot_ids: [PLOT_A],
  },
  {
    id: P.completeOne,
    status: "complete",
    created_at: "2026-09-07T06:00:00Z",
    finished_at: "2026-09-07T11:00:00Z",
    no_output_reason: null,
    plot_ids: [PLOT_A],
  },
  {
    id: P.completeThree,
    status: "complete",
    created_at: "2026-09-04T06:00:00Z",
    finished_at: "2026-09-04T12:00:00Z",
    no_output_reason: null,
    plot_ids: [PLOT_A, PLOT_B],
  },
  {
    id: P.failed,
    status: "failed",
    created_at: "2026-09-03T06:00:00Z",
    finished_at: "2026-09-03T06:20:00Z",
    no_output_reason: null,
    plot_ids: [PLOT_A],
  },
  {
    id: P.cancelled,
    status: "cancelled",
    created_at: "2026-09-02T06:00:00Z",
    finished_at: "2026-09-02T06:05:00Z",
    no_output_reason: null,
    plot_ids: [PLOT_A],
  },
  {
    id: P.withdrawn,
    status: "withdrawn",
    created_at: "2026-09-01T06:00:00Z",
    finished_at: "2026-09-05T06:00:00Z",
    no_output_reason: null,
    plot_ids: [PLOT_B],
  },
];

export const fixtureBlooms: CabinetBloom[] = [
  {
    id: B.fresh,
    pass_id: P.completeOne,
    kind: "question",
    ordinal: 0,
    interpretation:
      "Is it the standing still, rather than the distance, that the short route costs you?",
    evidence: [
      {
        revision_id: REV_2_NEW,
        excerpt:
          "Maybe it is not distance I mind but standing still.",
      },
    ],
    created_at: "2026-09-07T11:00:00Z",
  },
  {
    id: B.kept,
    pass_id: P.completeThree,
    kind: "connection",
    ordinal: 0,
    interpretation:
      "Two entries describe the longer walk as arriving sooner; the heron appears both times.",
    evidence: [
      {
        revision_id: REV_1,
        excerpt:
          "It is eleven minutes longer by the watch and somehow arrives sooner in the head.",
      },
      {
        revision_id: REV_1,
        excerpt: "I keep noticing the same heron.",
      },
    ],
    created_at: "2026-09-04T12:00:00Z",
  },
  {
    id: B.corrected,
    pass_id: P.completeThree,
    kind: "change",
    ordinal: 1,
    interpretation:
      "The reason for preferring the long route shifted from time to movement between drafts.",
    evidence: [
      {
        revision_id: REV_2_OLD,
        excerpt: "the short route is all waiting at crossings",
      },
      {
        revision_id: REV_1,
        excerpt: "somehow arrives sooner in the head",
      },
    ],
    created_at: "2026-09-04T12:00:00Z",
  },
  {
    id: B.pruned,
    pass_id: P.completeThree,
    kind: "tension",
    ordinal: 2,
    interpretation:
      "Keeping a lamp that never worked sits oddly beside minding time spent waiting.",
    evidence: [
      {
        revision_id: REV_3,
        excerpt: "one that has never worked. Kept it anyway.",
      },
      {
        revision_id: REV_GONE,
        excerpt: "waiting is the part I resent",
      },
    ],
    created_at: "2026-09-04T12:00:00Z",
  },
  {
    id: B.gone,
    pass_id: P.withdrawn,
    kind: "connection",
    ordinal: 0,
    interpretation:
      "Withdrawn blooms are hidden by row-level security in the live app; this row exercises the withdrawn rendering only.",
    evidence: [{ revision_id: REV_3, excerpt: "Counted the lamps" }],
    created_at: "2026-09-01T09:00:00Z",
  },
];

export const fixtureResponses: CabinetResponse[] = [
  {
    id: "00000000-0000-4000-8000-000000000301",
    bloom_id: B.kept,
    response: "keep",
    correction: null,
    created_at: "2026-09-05T07:00:00Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000302",
    bloom_id: B.corrected,
    response: "correct",
    correction:
      "It was never about time. I always knew the long way was slower; what changed is that I stopped pretending otherwise.",
    created_at: "2026-09-05T07:05:00Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000303",
    bloom_id: B.corrected,
    response: "keep",
    correction: null,
    created_at: "2026-09-04T20:00:00Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000304",
    bloom_id: B.pruned,
    response: "prune",
    correction: null,
    created_at: "2026-09-05T07:10:00Z",
  },
];

export type FixtureScene = {
  slug: string;
  title: string;
  description: string;
  passIds: string[];
};
export const fixtureScenes: FixtureScene[] = [
  {
    slug: "all",
    title: "Every state at once",
    description: "All eight pass states and all five bloom states.",
    passIds: Object.values(P),
  },
  {
    slug: "empty",
    title: "No returns yet",
    description: "Nothing invited, nothing waiting.",
    passIds: [],
  },
  {
    slug: "waiting",
    title: "Queued and processing",
    description: "Active passes that can still be cancelled.",
    passIds: [P.queued, P.processing],
  },
  {
    slug: "nothing-new",
    title: "Complete with zero blooms",
    description: "A valid return that offers nothing.",
    passIds: [P.completeEmpty],
  },
  {
    slug: "one-bloom",
    title: "Complete with one fresh bloom",
    description: "An unanswered open question with a current clipping.",
    passIds: [P.completeOne],
  },
  {
    slug: "three-blooms",
    title: "Complete with three blooms",
    description:
      "Kept, corrected twice, and pruned; superseded, archived, and unlinked clippings.",
    passIds: [P.completeThree],
  },
  {
    slug: "not-returned",
    title: "Failed and cancelled",
    description: "Passes that ended without a return.",
    passIds: [P.failed, P.cancelled],
  },
  {
    slug: "withdrawn",
    title: "Withdrawn",
    description: "A return withdrawn after permissions changed.",
    passIds: [P.withdrawn],
  },
];
