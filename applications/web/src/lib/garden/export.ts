import type { Tables } from "../../types/database";

export type ExportSnapshot = {
  exported_at: string;
  gardens: Tables<"gardens">[];
  plots: Tables<"plots">[];
  seeds: Tables<"seeds">[];
  entries: Tables<"entries">[];
  revisions: Tables<"seed_revisions">[];
  passes: Tables<"garden_passes">[];
  blooms: Tables<"blooms">[];
  responses: Tables<"bloom_responses">[];
};

export function filterSnapshotByGarden(
  s: ExportSnapshot,
  gardenId: string,
): ExportSnapshot {
  const blooms = s.blooms.filter((b) => b.garden_id === gardenId);
  const bloomIds = new Set(blooms.map((b) => b.id));
  return {
    ...s,
    gardens: s.gardens.filter((g) => g.id === gardenId),
    plots: s.plots.filter((p) => p.garden_id === gardenId),
    seeds: s.seeds.filter((x) => x.garden_id === gardenId),
    entries: s.entries.filter((e) => e.garden_id === gardenId),
    revisions: s.revisions.filter((r) => r.garden_id === gardenId),
    passes: s.passes.filter((p) => p.garden_id === gardenId),
    blooms,
    responses: s.responses.filter((r) => bloomIds.has(r.bloom_id)),
  };
}

export function buildExportDocument(s: ExportSnapshot) {
  return {
    schema: "slow-garden-export-v2" as const,
    exported_at: s.exported_at,
    source: {
      authorship: "user" as const,
      gardens: s.gardens,
      plots: s.plots,
      seeds: s.seeds,
      entries: s.entries,
      revisions: s.revisions,
    },
    derived: {
      note: "Blooms are AI-derived interpretations traceable to source revisions via evidence. Responses are the author's replies to blooms.",
      passes: s.passes,
      blooms: { authorship: "ai-derived" as const, rows: s.blooms },
      responses: { authorship: "user" as const, rows: s.responses },
    },
  };
}

export function formatExportMarkdown(s: ExportSnapshot): string {
  return [
    "# Slow Garden — export",
    "",
    ...s.gardens.flatMap((g) => [
      "## " + g.name,
      "",
      ...s.plots
        .filter((p) => p.garden_id === g.id)
        .flatMap((p) => [
          "### " + p.name,
          "",
          ...s.seeds
            .filter((x) => x.plot_id === p.id)
            .flatMap((x) => [
              "#### " + x.title,
              "",
              ...s.entries
                .filter((e) => e.seed_id === x.id)
                .flatMap((e) => [
                  "##### Entry " + e.id + " · " + e.created_at,
                  ...s.revisions
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
    "## Derived material (AI)",
    "",
    ...(s.passes.length
      ? s.passes.flatMap((p) => [
          "### Pass " + p.id + " · " + p.created_at + " · " + p.status,
          "",
          ...s.blooms
            .filter((b) => b.pass_id === p.id)
            .flatMap((b) => [
              "#### Bloom " + b.ordinal + " · " + b.kind + " · AI-derived",
              "",
              b.interpretation,
              "",
              "Evidence: " + JSON.stringify(b.evidence),
              "",
              ...s.responses
                .filter((r) => r.bloom_id === b.id)
                .flatMap((r) => [
                  "Response · " + r.response + " · " + r.created_at,
                  ...(r.correction
                    ? ["Correction (author): " + r.correction]
                    : []),
                  "",
                ]),
            ]),
        ])
      : ["No derived material."]),
  ].join("\n");
}

export function exportFilename(
  format: "json" | "md",
  gardenName?: string,
): string {
  const slug = gardenName
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `slow-garden-export${slug ? `-${slug}` : ""}.${format}`;
}
