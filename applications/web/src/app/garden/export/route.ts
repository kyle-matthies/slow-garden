import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/garden/data";
import {
  buildExportDocument,
  exportFilename,
  filterSnapshotByGarden,
  formatExportMarkdown,
  type ExportSnapshot,
} from "@/lib/garden/export";
import type { Tables } from "@/types/database";
type SourceExport = Omit<
  ExportSnapshot,
  "passes" | "blooms" | "responses"
>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request: Request) {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub)
    return new Response("Unauthorized", { status: 401 });
  try {
    const { data: snapshot, error: exportError } = await db.rpc(
      "export_garden_sources",
    );
    if (exportError || !snapshot)
      throw exportError ?? new Error("Export unavailable");
    const source = snapshot as unknown as SourceExport;
    const [passes, blooms, responses] = await Promise.all([
      allRows<Tables<"garden_passes">>((a, b) =>
        db
          .from("garden_passes")
          .select("*")
          .order("created_at")
          .order("id")
          .range(a, b),
      ),
      allRows<Tables<"blooms">>((a, b) =>
        db
          .from("blooms")
          .select("*")
          .order("created_at")
          .order("id")
          .range(a, b),
      ),
      allRows<Tables<"bloom_responses">>((a, b) =>
        db
          .from("bloom_responses")
          .select("*")
          .order("created_at")
          .order("id")
          .range(a, b),
      ),
    ]);
    let full: ExportSnapshot = { ...source, passes, blooms, responses };
    const params = new URL(request.url).searchParams;
    const gardenId = params.get("garden");
    if (gardenId) {
      if (!UUID.test(gardenId))
        return new Response("Invalid garden id", { status: 400 });
      if (!full.gardens.some((g) => g.id === gardenId))
        return new Response("Garden not found", { status: 404 });
      full = filterSnapshotByGarden(full, gardenId);
    }
    const markdown = params.get("format") === "md";
    const gardenName = full.gardens[0]?.name;
    const text = markdown
      ? formatExportMarkdown(full)
      : JSON.stringify(buildExportDocument(full), null, 2);
    return new Response(text, {
      headers: {
        "Content-Type": markdown
          ? "text/markdown; charset=utf-8"
          : "application/json",
        "Content-Disposition": `attachment; filename="${exportFilename(markdown ? "md" : "json", gardenId ? gardenName : undefined)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Export failed; no partial export was produced.", {
      status: 503,
    });
  }
}
