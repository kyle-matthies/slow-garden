import type { Genome } from "./genome";
import type { GrowthStage } from "./growth";
import { lerp, seededRandom } from "./hash";
import type { FlowerForm, LeafForm } from "./species";

/**
 * Pure geometry for a living plant, in a viewBox whose origin is the base of
 * the stem and whose y axis points down (so the plant grows into negative y).
 * Rendering lives in app/garden/scene/living-plant.tsx.
 */
export const PLANT_VIEWBOX = {
  x: -120,
  y: -320,
  width: 240,
  height: 332,
} as const;
export const MAX_STEM = 280;

const r1 = (n: number) => Math.round(n * 10) / 10;
type Pt = readonly [number, number];

const STAGE_HEIGHT: Record<GrowthStage, number> = {
  seed: 0.07,
  sprout: 0.25,
  leafing: 0.5,
  budding: 0.8,
  flowering: 1,
};

export type Leaf = {
  kind: LeafForm;
  /** Attachment point and outward angle in degrees (0 = straight up). */
  at: Pt;
  angle: number;
  length: number;
  width: number;
  /** Leaf path in leaf-local coordinates, pointing up (negative y). */
  d: string;
  /** Midrib / rachis path in leaf-local coordinates. */
  rib: string;
};

export type HeadKind = "flower" | "bud";

export type Head = {
  kind: HeadKind;
  form: FlowerForm;
  at: Pt;
  /** Degrees; rotates the head around its attachment. */
  tilt: number;
  /** 0.4..1: vertical squash that turns a face toward the viewer. */
  foreshorten: number;
  radius: number;
  /** For spike/plume heads: the stem segment the florets hang from. */
  spine?: { from: Pt; to: Pt };
};

export type PlantShape = {
  height: number;
  stem: string;
  stemWidth: number;
  branches: string[];
  leaves: Leaf[];
  heads: Head[];
  /** Ground contact shadow radius. */
  shadow: number;
  /** Bounding box of the drawn plant, used to size the hit area. */
  bounds: { top: number; left: number; right: number };
};

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] +
      3 * u * u * t * p1[0] +
      3 * u * t * t * p2[0] +
      t * t * t * p3[0],
    u * u * u * p0[1] +
      3 * u * u * t * p1[1] +
      3 * u * t * t * p2[1] +
      t * t * t * p3[1],
  ];
}

function cubicTangent(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const x =
    3 * u * u * (p1[0] - p0[0]) +
    6 * u * t * (p2[0] - p1[0]) +
    3 * t * t * (p3[0] - p2[0]);
  const y =
    3 * u * u * (p1[1] - p0[1]) +
    6 * u * t * (p2[1] - p1[1]) +
    3 * t * t * (p3[1] - p2[1]);
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}

/** A tapered ribbon along a cubic curve, filled rather than stroked. */
function ribbon(
  p0: Pt,
  p1: Pt,
  p2: Pt,
  p3: Pt,
  w0: number,
  w1: number,
  steps = 18,
) {
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = cubic(p0, p1, p2, p3, t);
    const [tx, ty] = cubicTangent(p0, p1, p2, p3, t);
    const w = lerp(w0, w1, t) / 2;
    left.push(`${r1(x - ty * w)},${r1(y + tx * w)}`);
    right.push(`${r1(x + ty * w)},${r1(y - tx * w)}`);
  }
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

function leafPath(
  kind: LeafForm,
  length: number,
  width: number,
  random: () => number,
) {
  const L = length;
  const W = width;
  switch (kind) {
    case "lance":
      return {
        d: `M0,0C${r1(W * 0.9)},${r1(-L * 0.18)} ${r1(W * 0.75)},${r1(-L * 0.8)} 0,${r1(-L)}C${r1(-W * 0.6)},${r1(-L * 0.78)} ${r1(-W * 0.95)},${r1(-L * 0.2)} 0,0Z`,
        rib: `M0,0Q${r1(W * 0.08)},${r1(-L * 0.5)} 0,${r1(-L * 0.96)}`,
      };
    case "grass":
      return {
        d: `M${r1(-W * 0.3)},0Q${r1(W * 0.6)},${r1(-L * 0.55)} ${r1(W * 1.6)},${r1(-L)}Q${r1(W * 0.2)},${r1(-L * 0.5)} ${r1(W * 0.3)},0Z`,
        rib: `M0,0Q${r1(W * 0.5)},${r1(-L * 0.55)} ${r1(W * 1.5)},${r1(-L * 0.98)}`,
      };
    case "trifoliate": {
      // Three oval leaflets on a short petiole.
      const p = L * 0.42;
      const lf = (a: number) => {
        const rad = (a * Math.PI) / 180;
        const cx = Math.sin(rad) * p * 0.55;
        const cy = -p - Math.cos(rad) * p * 0.55;
        const rx = W * 0.62;
        const ry = L * 0.32;
        const ux = Math.sin(rad) * ry;
        const uy = -Math.cos(rad) * ry;
        return `M${r1(cx - ux)},${r1(cy - uy)}A${r1(rx)},${r1(ry)} ${a} 1,0 ${r1(cx + ux)},${r1(cy + uy)}A${r1(rx)},${r1(ry)} ${a} 1,0 ${r1(cx - ux)},${r1(cy - uy)}Z`;
      };
      return { d: `${lf(-55)}${lf(0)}${lf(55)}`, rib: `M0,0L0,${r1(-p)}` };
    }
    case "palmate": {
      const count = 7 + Math.floor(random() * 3);
      const p = L * 0.45;
      let d = "";
      for (let i = 0; i < count; i++) {
        const a = lerp(-80, 80, i / (count - 1));
        const rad = (a * Math.PI) / 180;
        const len = L * (0.62 - Math.abs(a) / 400);
        const tx = Math.sin(rad) * len;
        const ty = -p - Math.cos(rad) * len;
        const nx = Math.cos(rad) * W * 0.16;
        const ny = Math.sin(rad) * W * 0.16;
        d += `M0,${r1(-p)}Q${r1(tx * 0.5 + nx)},${r1((ty - p) / 2 + ny)} ${r1(tx)},${r1(ty)}Q${r1(tx * 0.5 - nx)},${r1((ty - p) / 2 - ny)} 0,${r1(-p)}Z`;
      }
      return { d, rib: `M0,0L0,${r1(-p)}` };
    }
    case "pinnate":
    default: {
      // Feathery: narrow leaflets along a rachis, shrinking toward the tip.
      const pairs = 4 + Math.floor(random() * 3);
      let d = "";
      for (let i = 0; i < pairs; i++) {
        const t = (i + 0.6) / (pairs + 0.4);
        const y = -L * t;
        const len = W * 1.6 * (1 - t * 0.6);
        const w = Math.max(1.1, W * 0.22 * (1 - t * 0.4));
        for (const side of [-1, 1]) {
          const tipX = side * len;
          const tipY = y - len * 0.55;
          d += `M0,${r1(y)}Q${r1(tipX * 0.5)},${r1(y - len * 0.1 - w)} ${r1(tipX)},${r1(tipY)}Q${r1(tipX * 0.5)},${r1(y - len * 0.1 + w)} 0,${r1(y + w * 0.5)}Z`;
        }
      }
      d += `M0,${r1(-L * 0.92)}Q${r1(W * 0.3)},${r1(-L)} 0,${r1(-L * 1.08)}Q${r1(-W * 0.3)},${r1(-L)} 0,${r1(-L * 0.92)}Z`;
      return { d, rib: `M0,0L0,${r1(-L * 1.02)}` };
    }
  }
}

/** Geometry for one plant at one growth stage. Deterministic for a genome. */
export function plantShape(
  genome: Genome,
  stage: GrowthStage,
  vigor: number,
): PlantShape {
  const random = seededRandom(genome.seed ^ 0x9e3779b9);
  const { species } = genome;
  const height =
    MAX_STEM * genome.height * STAGE_HEIGHT[stage] * (0.94 + 0.06 * vigor);
  const lean = genome.lean;
  const p0: Pt = [0, 0];
  const p1: Pt = [lean * 6, -height * 0.34];
  const p2: Pt = [lean * 20, -height * 0.7];
  const p3: Pt = [lean * 16, -height];
  const stemWidth = stage === "seed" ? 1.6 : stage === "sprout" ? 2.2 : 3.4;
  const stem = ribbon(p0, p1, p2, p3, stemWidth, stemWidth * 0.45);
  const leaves: Leaf[] = [];
  const heads: Head[] = [];
  const branches: string[] = [];
  const formScale = genome.height;
  let left = -20;
  let right = 20;
  const grow = (x: number) => {
    left = Math.min(left, x);
    right = Math.max(right, x);
  };

  if (stage === "seed" || stage === "sprout") {
    // Two seed leaves at the tip.
    const size = stage === "seed" ? 7 : 13;
    for (const side of [-1, 1]) {
      const { d, rib } = leafPath("lance", size, size * 0.7, random);
      leaves.push({
        kind: "lance",
        at: p3,
        angle: side * (58 + random() * 10),
        length: size,
        width: size * 0.7,
        d,
        rib,
      });
      grow(p3[0] + side * size);
    }
    return {
      height,
      stem,
      stemWidth,
      branches,
      leaves,
      heads,
      shadow: stage === "seed" ? 10 : 14,
      bounds: { top: -height - size, left, right },
    };
  }

  // Leaves along the lower two thirds, alternating sides.
  const count = Math.round(
    lerp(2, genome.leafCount, stage === "leafing" ? 0.45 + vigor * 0.4 : 1),
  );
  const isGrass = species.leaf === "grass";
  for (let i = 0; i < count; i++) {
    const t = isGrass
      ? 0.01 + random() * 0.05
      : lerp(0.1, 0.66, (i + random() * 0.5) / count);
    const at = cubic(p0, p1, p2, p3, t);
    const side = i % 2 === 0 ? 1 : -1;
    const length = isGrass
      ? height * (0.45 + random() * 0.35)
      : (species.leaf === "trifoliate"
          ? 34
          : species.leaf === "palmate"
            ? 46
            : 44) *
        formScale *
        (1 - t * 0.45) *
        (0.85 + random() * 0.3);
    const width = isGrass
      ? 4 + random() * 2
      : length * (species.leaf === "lance" ? 0.32 : 0.36);
    const angle = isGrass
      ? side * (6 + random() * 16)
      : side *
        (species.leaf === "trifoliate" || species.leaf === "palmate"
          ? 48
          : 40 + random() * 22);
    const { d, rib } = leafPath(species.leaf, length, width, random);
    leaves.push({ kind: species.leaf, at, angle, length, width, d, rib });
    grow(at[0] + side * Math.sin((Math.abs(angle) * Math.PI) / 180) * length);
  }

  const radius =
    {
      ray: 40,
      cup: 40,
      fringed: 27,
      spike: 17,
      umbel: 32,
      globe: 19,
      plume: 11,
    }[species.form] * formScale;
  const tipTangent = cubicTangent(p0, p1, p2, p3, 1);
  const tipTilt = (Math.atan2(tipTangent[0], -tipTangent[1]) * 180) / Math.PI;
  const isRaceme = species.form === "spike" || species.form === "plume";

  if (stage === "leafing") {
    return {
      height,
      stem,
      stemWidth,
      branches,
      leaves,
      heads,
      shadow: 16,
      bounds: { top: -height - 8, left, right },
    };
  }

  if (stage === "budding") {
    heads.push({
      kind: "bud",
      form: species.form,
      at: p3,
      tilt: tipTilt + genome.tilt * 0.3,
      foreshorten: 1,
      radius: radius * (0.42 + 0.18 * vigor),
      spine: isRaceme
        ? { from: cubic(p0, p1, p2, p3, 0.72), to: p3 }
        : undefined,
    });
  } else {
    heads.push({
      kind: "flower",
      form: species.form,
      at: p3,
      tilt: tipTilt + genome.tilt,
      foreshorten:
        species.form === "ray" || species.form === "cup"
          ? 0.62 + random() * 0.26
          : 1,
      radius: radius * (0.94 + 0.12 * vigor),
      spine: isRaceme
        ? {
            from: cubic(p0, p1, p2, p3, species.form === "spike" ? 0.5 : 0.68),
            to: p3,
          }
        : undefined,
    });
    // Side stems: more as the thought is tended further; a bud on the last.
    const extra = isRaceme
      ? Math.floor(genome.branches * vigor * 0.5)
      : Math.round(genome.branches * vigor);
    for (let i = 0; i < extra + 1; i++) {
      const t = lerp(0.48, 0.72, random());
      const from = cubic(p0, p1, p2, p3, t);
      const side = (i + (genome.seed & 1)) % 2 === 0 ? 1 : -1;
      const len = height * (0.3 + random() * 0.22);
      const to: Pt = [from[0] + side * len * 0.42, from[1] - len * 0.86];
      const c1: Pt = [from[0] + side * len * 0.08, from[1] - len * 0.35];
      const c2: Pt = [to[0] - side * len * 0.12, to[1] + len * 0.25];
      branches.push(
        ribbon(from, c1, c2, to, stemWidth * 0.7, stemWidth * 0.35, 10),
      );
      const isBud = i === extra;
      heads.push({
        kind: isBud ? "bud" : "flower",
        form: species.form,
        at: to,
        tilt: side * (14 + random() * 18),
        foreshorten:
          species.form === "ray" || species.form === "cup"
            ? 0.55 + random() * 0.3
            : 1,
        radius: radius * (isBud ? 0.38 : 0.78),
        spine: isRaceme
          ? {
              from: [lerp(from[0], to[0], 0.45), lerp(from[1], to[1], 0.45)],
              to,
            }
          : undefined,
      });
      grow(to[0] + side * radius);
    }
  }
  for (const head of heads) {
    grow(head.at[0] - head.radius);
    grow(head.at[0] + head.radius);
  }
  return {
    height,
    stem,
    stemWidth,
    branches,
    leaves,
    heads,
    shadow: 18 + radius * 0.4,
    bounds: { top: -height - radius * (isRaceme ? 0.4 : 1.1), left, right },
  };
}

/* ---------- Flower parts, in head-local coordinates (petals point up) ---------- */

export function rayPetal(radius: number, width: number, notched: boolean) {
  const R = radius;
  const w = width;
  const tip = notched
    ? `L${r1(w * 0.22)},${r1(-R * 0.93)}L${r1(w * 0.08)},${r1(-R * 0.99)}L0,${r1(-R * 0.92)}L${r1(-w * 0.1)},${r1(-R * 0.995)}L${r1(-w * 0.24)},${r1(-R * 0.93)}`
    : `Q0,${r1(-R * 1.04)} ${r1(-w * 0.3)},${r1(-R * 0.97)}`;
  return `M0,0C${r1(w * 0.55)},${r1(-R * 0.16)} ${r1(w * 0.98)},${r1(-R * 0.62)} ${r1(w * 0.5)},${r1(-R * 0.96)}${tip}C${r1(-w * 0.98)},${r1(-R * 0.62)} ${r1(-w * 0.55)},${r1(-R * 0.16)} 0,0Z`;
}

export function petalVeins(radius: number, width: number) {
  const R = radius;
  const w = width;
  return `M0,${r1(-R * 0.12)}L0,${r1(-R * 0.86)}M0,${r1(-R * 0.18)}Q${r1(w * 0.3)},${r1(-R * 0.5)} ${r1(w * 0.3)},${r1(-R * 0.82)}M0,${r1(-R * 0.18)}Q${r1(-w * 0.3)},${r1(-R * 0.5)} ${r1(-w * 0.3)},${r1(-R * 0.82)}`;
}

export function cupPetal(radius: number, notched: boolean) {
  const R = radius;
  const w = R * 0.78;
  const tip = notched
    ? `Q${r1(w * 0.3)},${r1(-R * 1.04)} 0,${r1(-R * 0.9)}Q${r1(-w * 0.3)},${r1(-R * 1.04)} ${r1(-w * 0.62)},${r1(-R * 0.9)}`
    : `Q${r1(w * 0.2)},${r1(-R * 1.08)} ${r1(-w * 0.1)},${r1(-R * 1.0)}Q${r1(-w * 0.45)},${r1(-R * 1.02)} ${r1(-w * 0.62)},${r1(-R * 0.9)}`;
  return `M0,0C${r1(w * 0.8)},${r1(-R * 0.08)} ${r1(w * 1.12)},${r1(-R * 0.62)} ${r1(w * 0.62)},${r1(-R * 0.9)}${tip}C${r1(-w * 1.12)},${r1(-R * 0.62)} ${r1(-w * 0.8)},${r1(-R * 0.08)} 0,0Z`;
}

export function fringedFloret(radius: number) {
  const R = radius;
  const w = R * 0.52;
  return `M0,0L${r1(w * 0.28)},${r1(-R * 0.5)}L${r1(w * 0.62)},${r1(-R * 0.84)}L${r1(w * 0.46)},${r1(-R * 1.0)}L${r1(w * 0.27)},${r1(-R * 0.88)}L${r1(w * 0.1)},${r1(-R * 1.04)}L${r1(-w * 0.08)},${r1(-R * 0.9)}L${r1(-w * 0.26)},${r1(-R * 1.02)}L${r1(-w * 0.44)},${r1(-R * 0.88)}L${r1(-w * 0.62)},${r1(-R * 0.84)}L${r1(-w * 0.28)},${r1(-R * 0.5)}Z`;
}

/** A hanging bell (foxglove), opening downward, in floret-local coordinates. */
export function bellFloret(size: number) {
  const s = size;
  return `M${r1(-s * 0.16)},0C${r1(-s * 0.3)},${r1(s * 0.22)} ${r1(-s * 0.36)},${r1(s * 0.56)} ${r1(-s * 0.5)},${r1(s * 0.86)}Q${r1(-s * 0.2)},${r1(s * 0.94)} 0,${r1(s * 0.9)}Q${r1(s * 0.24)},${r1(s * 0.96)} ${r1(s * 0.5)},${r1(s * 0.84)}C${r1(s * 0.38)},${r1(s * 0.54)} ${r1(s * 0.3)},${r1(s * 0.22)} ${r1(s * 0.16)},0Z`;
}

/** A pea flower (lupine): banner plus keel, in floret-local coordinates. */
export function peaFloret(size: number) {
  const s = size;
  return `M0,0C${r1(s * 0.6)},${r1(-s * 0.1)} ${r1(s * 0.7)},${r1(-s * 0.7)} 0,${r1(-s * 0.85)}C${r1(-s * 0.7)},${r1(-s * 0.7)} ${r1(-s * 0.6)},${r1(-s * 0.1)} 0,0Z`;
}

export function budPath(radius: number) {
  const R = radius;
  return `M0,0C${r1(R * 0.62)},${r1(-R * 0.1)} ${r1(R * 0.7)},${r1(-R * 1.0)} 0,${r1(-R * 1.6)}C${r1(-R * 0.7)},${r1(-R * 1.0)} ${r1(-R * 0.62)},${r1(-R * 0.1)} 0,0Z`;
}

export function sepalPath(radius: number) {
  const R = radius;
  return `M0,0Q${r1(R * 0.7)},${r1(-R * 0.3)} ${r1(R * 0.34)},${r1(-R * 0.95)}Q${r1(R * 0.22)},${r1(-R * 0.4)} 0,${r1(-R * 0.2)}Q${r1(-R * 0.22)},${r1(-R * 0.4)} ${r1(-R * 0.34)},${r1(-R * 0.95)}Q${r1(-R * 0.7)},${r1(-R * 0.3)} 0,0Z`;
}

/** Evenly spaced angles with a small deterministic jitter. */
export function petalAngles(count: number, seed: number) {
  const random = seededRandom(seed);
  const offset = random() * 360;
  return Array.from({ length: count }, (_, i) =>
    r1(offset + (i * 360) / count + (random() - 0.5) * (120 / count)),
  );
}

/** Points along a spike/plume spine with a size falloff toward the tip. */
export function racemePoints(from: Pt, to: Pt, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : i / (count - 1);
    return {
      at: [r1(lerp(from[0], to[0], t)), r1(lerp(from[1], to[1], t))] as Pt,
      t,
    };
  });
}

export { r1 as round1 };
