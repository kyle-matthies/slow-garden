export type Garden = { id: string; name: string; status: string };
export type Plot = {
  id: string;
  garden_id: string;
  name: string;
  ai_enabled: boolean;
  cross_pollinate: boolean;
  archived_at: string | null;
  permission_version: number;
};
export type Seed = {
  id: string;
  garden_id: string;
  plot_id: string;
  title: string;
  status: string;
  created_at: string;
};
export type Entry = {
  entry_id: string;
  revision_id: string;
  seed_id: string;
  body: string;
  revision_number: number;
  created_at: string;
  revised_at: string;
  archived_at: string | null;
};
export type GardenData = {
  tenantId: string;
  gardens: Garden[];
  gardenId: string;
  plots: Plot[];
  seeds: Seed[];
  entries: Entry[];
  aiAvailable: boolean;
};
export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; message: string };
