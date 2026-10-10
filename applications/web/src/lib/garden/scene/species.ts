/**
 * The botanical library. Each species fixes a living form for the meadow and
 * a pressed specimen for the Cabinet, so the two always look like the same
 * plant. Species, colour and size are identity only: they never encode mood,
 * confidence, importance or engagement.
 */
export type FlowerForm =
  | "ray"
  | "cup"
  | "fringed"
  | "spike"
  | "umbel"
  | "globe"
  | "plume";
export type LeafForm = "pinnate" | "lance" | "trifoliate" | "palmate" | "grass";

export type HSL = readonly [hue: number, saturation: number, lightness: number];

export type Species = {
  id: string;
  common: string;
  latin: string;
  form: FlowerForm;
  leaf: LeafForm;
  petals: readonly [min: number, max: number];
  /** Natural colour variants; a plant picks one and jitters within it. */
  colours: readonly HSL[];
  centre: HSL;
  stem: HSL;
  /** Relative mature height, 1 = tallest. */
  height: readonly [min: number, max: number];
  /** Photographic pressed specimen, when one exists in the asset manifest. */
  pressed?: string;
};

export const SPECIES: readonly Species[] = [
  {
    id: "cosmos",
    common: "Cosmos",
    latin: "Cosmos bipinnatus",
    form: "ray",
    leaf: "pinnate",
    petals: [8, 8],
    colours: [
      [40, 30, 96],
      [330, 62, 82],
      [332, 58, 66],
      [345, 52, 54],
    ],
    centre: [46, 92, 52],
    stem: [96, 34, 38],
    height: [0.85, 1],
    pressed: "/garden/specimens/cosmos",
  },
  {
    id: "poppy",
    common: "Corn poppy",
    latin: "Papaver rhoeas",
    form: "cup",
    leaf: "pinnate",
    petals: [4, 4],
    colours: [
      [4, 82, 52],
      [12, 86, 58],
      [354, 70, 50],
    ],
    centre: [250, 30, 14],
    stem: [92, 30, 42],
    height: [0.62, 0.8],
  },
  {
    id: "cornflower",
    common: "Cornflower",
    latin: "Centaurea cyanus",
    form: "fringed",
    leaf: "lance",
    petals: [8, 10],
    colours: [
      [222, 70, 56],
      [214, 62, 62],
      [268, 40, 62],
    ],
    centre: [250, 40, 30],
    stem: [104, 18, 46],
    height: [0.6, 0.78],
  },
  {
    id: "foxglove",
    common: "Foxglove",
    latin: "Digitalis purpurea",
    form: "spike",
    leaf: "lance",
    petals: [9, 14],
    colours: [
      [318, 46, 66],
      [300, 30, 72],
      [40, 30, 92],
    ],
    centre: [320, 40, 30],
    stem: [98, 28, 36],
    height: [0.92, 1],
  },
  {
    id: "yarrow",
    common: "Yarrow",
    latin: "Achillea millefolium",
    form: "umbel",
    leaf: "pinnate",
    petals: [18, 28],
    colours: [
      [48, 30, 94],
      [340, 40, 84],
      [40, 24, 88],
    ],
    centre: [48, 40, 76],
    stem: [100, 22, 40],
    height: [0.66, 0.84],
  },
  {
    id: "clover",
    common: "Red clover",
    latin: "Trifolium pratense",
    form: "globe",
    leaf: "trifoliate",
    petals: [26, 34],
    colours: [
      [326, 52, 66],
      [318, 44, 72],
    ],
    centre: [326, 40, 50],
    stem: [104, 28, 40],
    height: [0.36, 0.5],
  },
  {
    id: "dog-rose",
    common: "Dog rose",
    latin: "Rosa canina",
    form: "cup",
    leaf: "lance",
    petals: [5, 5],
    colours: [
      [340, 62, 86],
      [350, 56, 80],
      [40, 40, 95],
    ],
    centre: [48, 90, 58],
    stem: [110, 26, 34],
    height: [0.7, 0.9],
  },
  {
    id: "chamomile",
    common: "Chamomile",
    latin: "Matricaria chamomilla",
    form: "ray",
    leaf: "pinnate",
    petals: [13, 16],
    colours: [[48, 25, 97]],
    centre: [48, 94, 54],
    stem: [92, 30, 42],
    height: [0.44, 0.6],
  },
  {
    id: "lupine",
    common: "Lupine",
    latin: "Lupinus polyphyllus",
    form: "spike",
    leaf: "palmate",
    petals: [14, 20],
    colours: [
      [258, 42, 62],
      [232, 46, 64],
      [330, 40, 74],
    ],
    centre: [258, 40, 40],
    stem: [100, 22, 38],
    height: [0.8, 0.96],
  },
  {
    id: "meadow-grass",
    common: "Meadow foxtail",
    latin: "Alopecurus pratensis",
    form: "plume",
    leaf: "grass",
    petals: [12, 18],
    colours: [
      [44, 40, 70],
      [36, 34, 64],
    ],
    centre: [44, 36, 56],
    stem: [70, 26, 48],
    height: [0.74, 0.92],
  },
];

export function speciesById(id: string): Species {
  return SPECIES.find((s) => s.id === id) ?? SPECIES[0];
}
