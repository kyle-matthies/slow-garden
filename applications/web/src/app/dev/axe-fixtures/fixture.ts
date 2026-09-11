import type { GardenData } from "@/lib/garden/types";

// Synthetic fixture data for the axe accessibility harness only.
// Ids are duplicated in applications/web/accessibility/axe-check.mjs — keep in sync.
export const FIXTURE_PLOT_ID = "00000000-0000-4000-8000-000000000100";
export const FIXTURE_SEED_ID = "00000000-0000-4000-8000-000000001000";

const GARDEN_ID = "00000000-0000-4000-8000-000000000010";
const PLOT_TWO = "00000000-0000-4000-8000-000000000200";
const PLOT_ARCHIVED = "00000000-0000-4000-8000-000000000300";
const SEED_TWO = "00000000-0000-4000-8000-000000002000";
const SEED_THREE = "00000000-0000-4000-8000-000000003000";

export const FIXTURE: GardenData = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  gardens: [
    { id: GARDEN_ID, name: "Fixture garden", status: "active" },
    {
      id: "00000000-0000-4000-8000-000000000020",
      name: "Archived fixture garden",
      status: "archived",
    },
  ],
  gardenId: GARDEN_ID,
  plots: [
    {
      id: FIXTURE_PLOT_ID,
      garden_id: GARDEN_ID,
      name: "Fixture topic one",
      ai_enabled: false,
      cross_pollinate: false,
      archived_at: null,
      permission_version: 1,
    },
    {
      id: PLOT_TWO,
      garden_id: GARDEN_ID,
      name: "Fixture topic two",
      ai_enabled: true,
      cross_pollinate: true,
      archived_at: null,
      permission_version: 1,
    },
    {
      id: PLOT_ARCHIVED,
      garden_id: GARDEN_ID,
      name: "Archived fixture topic",
      ai_enabled: false,
      cross_pollinate: false,
      archived_at: "2025-01-02T00:00:00.000Z",
      permission_version: 1,
    },
  ],
  seeds: [
    {
      id: FIXTURE_SEED_ID,
      garden_id: GARDEN_ID,
      plot_id: FIXTURE_PLOT_ID,
      title: "Synthetic fixture thought one",
      status: "active",
      created_at: "2025-01-01T09:00:00.000Z",
    },
    {
      id: SEED_TWO,
      garden_id: GARDEN_ID,
      plot_id: FIXTURE_PLOT_ID,
      title: "Synthetic fixture thought two",
      status: "active",
      created_at: "2025-01-01T10:00:00.000Z",
    },
    {
      id: SEED_THREE,
      garden_id: GARDEN_ID,
      plot_id: PLOT_TWO,
      title: "Synthetic fixture thought three",
      status: "active",
      created_at: "2025-01-01T11:00:00.000Z",
    },
  ],
  entries: [
    {
      entry_id: "00000000-0000-4000-8000-000000010001",
      revision_id: "00000000-0000-4000-8000-000000020001",
      seed_id: FIXTURE_SEED_ID,
      body: "Synthetic fixture entry 1 — placeholder text for accessibility checks.",
      revision_number: 1,
      created_at: "2025-01-02T09:00:00.000Z",
      revised_at: "2025-01-02T09:00:00.000Z",
      archived_at: null,
    },
    {
      entry_id: "00000000-0000-4000-8000-000000010002",
      revision_id: "00000000-0000-4000-8000-000000020002",
      seed_id: FIXTURE_SEED_ID,
      body: "Synthetic fixture entry 2 — placeholder text for accessibility checks.",
      revision_number: 1,
      created_at: "2025-01-03T09:00:00.000Z",
      revised_at: "2025-01-03T09:00:00.000Z",
      archived_at: null,
    },
    {
      entry_id: "00000000-0000-4000-8000-000000010003",
      revision_id: "00000000-0000-4000-8000-000000020003",
      seed_id: SEED_TWO,
      body: "Synthetic fixture entry 3 — placeholder text for accessibility checks.",
      revision_number: 1,
      created_at: "2025-01-04T09:00:00.000Z",
      revised_at: "2025-01-04T09:00:00.000Z",
      archived_at: null,
    },
    {
      entry_id: "00000000-0000-4000-8000-000000010004",
      revision_id: "00000000-0000-4000-8000-000000020004",
      seed_id: SEED_THREE,
      body: "Synthetic fixture entry 4 — placeholder text for accessibility checks.",
      revision_number: 1,
      created_at: "2025-01-05T09:00:00.000Z",
      revised_at: "2025-01-05T09:00:00.000Z",
      archived_at: null,
    },
  ],
  aiAvailable: false,
};
