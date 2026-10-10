import { hashString, lerp, seededRandom } from "./hash";
import { SPECIES, type HSL, type Species } from "./species";

/** Everything needed to draw one thought's plant, derived only from its ID. */
export type Genome = {
  species: Species;
  seed: number;
  colour: HSL;
  petals: number;
  /** Mature height multiplier within the species range. */
  height: number;
  /** -1..1, the direction and strength of the stem's curve. */
  lean: number;
  /** Head tilt in degrees; foreshortening comes from it. */
  tilt: number;
  leafCount: number;
  /** Extra flowering stems for a mature plant. */
  branches: number;
  /** Small per-plant offset (seconds) on the meadow-wide gust. */
  swayDelay: number;
  /** How supple the plant is in the wind. */
  flex: number;
};

export function genomeFor(id: string): Genome {
  const seed = hashString(`plant:${id}`);
  const random = seededRandom(seed);
  const species = SPECIES[seed % SPECIES.length];
  const [h, s, l] =
    species.colours[Math.floor(random() * species.colours.length)];
  const colour: HSL = [
    (h + (random() - 0.5) * 8 + 360) % 360,
    Math.max(0, Math.min(100, s + (random() - 0.5) * 8)),
    Math.max(0, Math.min(100, l + (random() - 0.5) * 6)),
  ];
  const [pMin, pMax] = species.petals;
  return {
    species,
    seed,
    colour,
    petals: pMin + Math.floor(random() * (pMax - pMin + 1)),
    height: lerp(species.height[0], species.height[1], random()),
    lean: (random() - 0.5) * 1.6,
    tilt: (random() - 0.5) * 36,
    leafCount: 4 + Math.floor(random() * 4),
    branches: 1 + Math.floor(random() * 3),
    // Formerly a per-plant sway period; still drawn so later traits stay stable.
    swayDelay: (random(), -random() * 6),
    flex: 0.6 + random() * 0.8,
  };
}

export const hsl = ([h, s, l]: HSL, dl = 0, alpha = 1) =>
  `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${Math.max(0, Math.min(100, l + dl)).toFixed(1)}%${alpha < 1 ? ` / ${alpha}` : ""})`;
