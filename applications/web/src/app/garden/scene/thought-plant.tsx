"use client";
import { useMemo } from "react";
import type { Entry } from "@/lib/garden/types";
import { genomeFor } from "@/lib/garden/scene/genome";
import { growthFor } from "@/lib/garden/scene/growth";
import { LivingPlant } from "./living-plant";

/**
 * A thought's own plant outside the scene (list cards, the writing page), so
 * a thought looks the same everywhere. Decorative; the surrounding text names it.
 */
export function ThoughtPlant({
  seedId,
  entries,
  className = "plant-drawing",
}: {
  seedId: string;
  entries: readonly Entry[];
  className?: string;
}) {
  const genome = useMemo(() => genomeFor(seedId), [seedId]);
  const growth = useMemo(
    () => growthFor(entries.filter((e) => e.seed_id === seedId)),
    [entries, seedId],
  );
  return (
    <span className={`${className} thought-plant`} aria-hidden="true">
      <LivingPlant
        genome={genome}
        stage={growth.stage}
        vigor={growth.vigor}
        fit
      />
    </span>
  );
}

/** A topic shown as its three most grown plants. */
export function TopicPlants({
  seedIds,
  entries,
}: {
  seedIds: readonly string[];
  entries: readonly Entry[];
}) {
  const plants = useMemo(() => {
    const ranked = seedIds
      .map((id) => ({
        id,
        growth: growthFor(entries.filter((e) => e.seed_id === id)),
      }))
      .sort((a, b) => b.growth.contributions - a.growth.contributions)
      .slice(0, 3);
    return ranked.map((p) => ({ ...p, genome: genomeFor(p.id) }));
  }, [seedIds, entries]);
  return (
    <span className="plant-drawing topic-plants" aria-hidden="true">
      {plants.length === 0 ? (
        <span className="topic-plants-empty" />
      ) : (
        plants.map((p) => (
          <LivingPlant
            key={p.id}
            genome={p.genome}
            stage={p.growth.stage}
            vigor={p.growth.vigor}
            fit
          />
        ))
      )}
    </span>
  );
}
