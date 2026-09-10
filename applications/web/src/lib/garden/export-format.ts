import type { Tables } from "@/types/database";
import { PRIVATE_NO_STORE } from "./cache-headers";

export type SourceExport = {
  gardens: Tables<"gardens">[];
  plots: Tables<"plots">[];
  seeds: Tables<"seeds">[];
  entries: Tables<"entries">[];
  revisions: Tables<"seed_revisions">[];
  exported_at: string;
};

export function formatSourceExport(
  snapshot: SourceExport,
  format: "md" | "json",
): string {
  const { gardens, plots, seeds, entries, revisions, exported_at } = snapshot;
  return format === "md"
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
}

export function exportHeaders(
  format: "md" | "json",
): Record<string, string> {
  const markdown = format === "md";
  return {
    "Content-Type": markdown
      ? "text/markdown; charset=utf-8"
      : "application/json",
    "Content-Disposition": `attachment; filename="slow-garden-sources.${markdown ? "md" : "json"}"`,
    "Cache-Control": PRIVATE_NO_STORE,
    "X-Content-Type-Options": "nosniff",
  };
}
