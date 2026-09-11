import { createClient } from "@/lib/supabase/server";
import {
  exportHeaders,
  formatSourceExport,
  type SourceExport,
} from "@/lib/garden/export-format";
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
    const format = new URL(request.url).searchParams.get("format") === "md"
      ? "md"
      : "json";
    const text = formatSourceExport(
      snapshot as unknown as SourceExport,
      format,
    );
    return new Response(text, {
      headers: exportHeaders(format),
    });
  } catch {
    return new Response("Export failed; no partial export was produced.", {
      status: 503,
    });
  }
}
