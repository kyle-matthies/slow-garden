import { hashString } from "./hash";

/**
 * Light for a garden's vista. Chosen from the garden ID so each garden keeps
 * its own time of day; dark mode always uses night. Palettes are decorative
 * and carry no meaning. All text sits on paper, never directly on these
 * colours.
 */
export type PaletteName = "dawn" | "morning" | "golden" | "dusk" | "night";

export type Palette = {
  name: PaletteName;
  label: string;
  skyTop: string;
  skyHorizon: string;
  /** Sun or moon. */
  light: string;
  lightGlow: string;
  /** Height of the light above the horizon, 0..1 of the sky. */
  lightHeight: number;
  /** World angle of the light, so it drifts slightly as you turn. */
  lightAngle: number;
  haze: string;
  far: string;
  treeline: string;
  near: string;
  groundTop: string;
  groundBottom: string;
  /** Grass blade tones from far (hazy) to near (rich). */
  grass: readonly string[];
  /** Small decorative wildflower specks in the grass. */
  specks: readonly string[];
  /** Particles: pollen by day, fireflies at night. */
  particle: string;
  night: boolean;
};

export const PALETTES: Record<PaletteName, Palette> = {
  dawn: {
    name: "dawn",
    label: "Dawn",
    skyTop: "#b9c3e4",
    skyHorizon: "#f7dccb",
    light: "#fff1e2",
    lightGlow: "rgba(255, 214, 186, 0.55)",
    lightHeight: 0.18,
    lightAngle: 40,
    haze: "rgba(246, 226, 222, 0.55)",
    far: "#b8b4c6",
    treeline: "#7c8a88",
    near: "#90a77d",
    groundTop: "#88a26c",
    groundBottom: "#4f7040",
    grass: ["#a7b393", "#8ea877", "#78985f", "#5f8549", "#4b7239", "#3c5f2e"],
    specks: ["#fbf3ee", "#f2c9d4", "#f6e3a4"],
    particle: "rgba(255, 244, 230, 0.85)",
    night: false,
  },
  morning: {
    name: "morning",
    label: "Morning",
    skyTop: "#94c4e8",
    skyHorizon: "#e4f2f2",
    light: "#fffbea",
    lightGlow: "rgba(255, 249, 220, 0.6)",
    lightHeight: 0.62,
    lightAngle: -30,
    haze: "rgba(228, 242, 244, 0.55)",
    far: "#a6c3b6",
    treeline: "#6a9170",
    near: "#84ac69",
    groundTop: "#79a55a",
    groundBottom: "#40692f",
    grass: ["#a5c39a", "#8cb874", "#73a557", "#5c9243", "#477b33", "#376527"],
    specks: ["#ffffff", "#f7f0a6", "#cdd7fb"],
    particle: "rgba(255, 255, 240, 0.85)",
    night: false,
  },
  golden: {
    name: "golden",
    label: "Golden hour",
    skyTop: "#a3bfd6",
    skyHorizon: "#f7d59c",
    light: "#fff0c2",
    lightGlow: "rgba(255, 214, 140, 0.6)",
    lightHeight: 0.24,
    lightAngle: 70,
    haze: "rgba(247, 222, 170, 0.5)",
    far: "#c2b893",
    treeline: "#73805a",
    near: "#98a75f",
    groundTop: "#93a454",
    groundBottom: "#53682e",
    grass: ["#d1c08c", "#b8b36e", "#9ea457", "#848f45", "#6a7a37", "#53642b"],
    specks: ["#fff7e0", "#f4c58e", "#f0e2b0"],
    particle: "rgba(255, 236, 190, 0.9)",
    night: false,
  },
  dusk: {
    name: "dusk",
    label: "Dusk",
    skyTop: "#6a7aa5",
    skyHorizon: "#eab9a5",
    light: "#ffdcc6",
    lightGlow: "rgba(255, 190, 160, 0.5)",
    lightHeight: 0.06,
    lightAngle: -60,
    haze: "rgba(214, 176, 176, 0.45)",
    far: "#8a85a0",
    treeline: "#4d585b",
    near: "#6b7e61",
    groundTop: "#647a55",
    groundBottom: "#34482d",
    grass: ["#9a9a92", "#828c76", "#6c7d62", "#586c4f", "#46593f", "#364833"],
    specks: ["#f5e6ea", "#d9c4f0", "#f3d2b2"],
    particle: "rgba(255, 226, 210, 0.8)",
    night: false,
  },
  night: {
    name: "night",
    label: "Night",
    skyTop: "#0b1423",
    skyHorizon: "#26394b",
    light: "#eef2f7",
    lightGlow: "rgba(200, 216, 236, 0.28)",
    lightHeight: 0.58,
    lightAngle: 20,
    haze: "rgba(48, 66, 86, 0.45)",
    far: "#1e2d38",
    treeline: "#121e25",
    near: "#1c3028",
    groundTop: "#1d3127",
    groundBottom: "#0d1813",
    grass: ["#2a3a3c", "#24382f", "#1f3329", "#1a2d23", "#15261d", "#102018"],
    specks: ["#c6d2e6", "#a9b8d6", "#d6cfe8"],
    particle: "rgba(214, 240, 170, 0.9)",
    night: true,
  },
};

const DAY: readonly PaletteName[] = ["morning", "golden", "dawn", "dusk"];

export function paletteFor(gardenId: string, dark: boolean): Palette {
  if (dark) return PALETTES.night;
  return PALETTES[DAY[hashString(`palette:${gardenId}`) % DAY.length]];
}
