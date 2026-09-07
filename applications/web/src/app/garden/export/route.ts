import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";
type SourceExport = {
  gardens: Tables<"gardens">[];
  plots: Tables<"plots">[];
  seeds: Tables<"seeds">[];
  entries: Tables<"entries">[];
  revisions: Tables<"seed_revisions">[];
  exported_at: string;
};
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
    const { gardens, plots, seeds, entries, revisions, exported_at } =
      snapshot as unknown as SourceExport;
    const markdown = new URL(request.url).searchParams.get("format") === "md";
    const text = markdown
      ? [
          "# Slow Garden — source export",
          "",
          ...gardens.flatMap((g) => [
            "## " + g.name,
            "",
            ...plots
              .filter((p) => p.garden_id === g.id)
              .flatMap((p) => [
                "### " + p.name,
                "",
                ...seeds
                  .filter((s) => s.plot_id === p.id)
                  .flatMap((s) => [
                    "#### " + s.title,
                    "",
                    ...entries
                      .filter((e) => e.seed_id === s.id)
                      .flatMap((e) => [
                        "##### Entry " + e.id + " · " + e.created_at,
                        ...revisions
                          .filter((r) => r.entry_id === e.id)
                          .map(
                            (r) =>
                              "\nRevision " +
                              r.revision_number +
                              " · " +
                              r.created_at +
                              "\n\n" +
                              r.body +
                              "\n",
                          ),
                      ]),
                  ]),
              ]),
          ]),
        ].join("\n")
      : JSON.stringify(
          {
            schema: "slow-garden-source-v2",
            exported_at,
            gardens,
            plots,
            seeds,
            entries,
            revisions,
          },
          null,
          2,
        );
    return new Response(text, {
      headers: {
        "Content-Type": markdown
          ? "text/markdown; charset=utf-8"
          : "application/json",
        "Content-Disposition": `attachment; filename="slow-garden-sources.${markdown ? "md" : "json"}"`,
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
