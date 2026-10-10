"use client";
import { useMemo } from "react";
import { genomeFor } from "@/lib/garden/scene/genome";
import { LivingPlant } from "./living-plant";

/**
 * The same plant as in the meadow, pressed for the Cabinet. A photographed
 * specimen is used when one exists for the species and matches the plant's
 * colour; otherwise the plant is drawn flattened and dried. Decorative only:
 * the caption names it in words.
 */
export function PressedSpecimen({
  seedId,
  collected,
}: {
  seedId: string;
  collected?: string;
}) {
  const genome = useMemo(() => genomeFor(seedId), [seedId]);
  const { species, colour } = genome;
  const photo = species.pressed && colour[2] >= 88 ? species.pressed : null;
  const month = collected
    ? new Date(collected).toLocaleString(undefined, {
        month: "long",
        timeZone: "UTC",
      })
    : null;
  return (
    <figure className="pressed-specimen">
      <div className="pressed-sheet" aria-hidden="true">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a fixed, pre-sized asset
          <img
            className="pressed-photo"
            src={`${photo}-640.webp`}
            srcSet={`${photo}-320.webp 320w, ${photo}-640.webp 640w, ${photo}-971.webp 971w`}
            sizes="(max-width: 640px) 60vw, 280px"
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="pressed-drawn">
            <LivingPlant
              genome={genome}
              stage="flowering"
              vigor={0.5}
              fit
              pressed
            />
          </span>
        )}
        <span className="pressed-tape" />
      </div>
      <figcaption>
        <i>{species.latin}</i>
        {month && <span>Collected · {month}</span>}
      </figcaption>
    </figure>
  );
}
