"use client";
import { type MotionValue } from "motion/react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { bedOpacity, facing, wrap } from "@/lib/garden/scene/camera";
import { describeGrowth } from "@/lib/garden/scene/growth";
import { lerp, seededRandom, hashString } from "@/lib/garden/scene/hash";
import type { PlantSlot } from "@/lib/garden/scene/layout";
import type { SceneBedModel, ScenePlantModel } from "@/lib/garden/scene/model";
import type { Palette } from "@/lib/garden/scene/palette";
import { plantShape, type PlantShape } from "@/lib/garden/scene/plant-geometry";
import { swayStyle } from "@/lib/garden/scene/sway";
import { threadsFor, type Tending } from "@/lib/garden/scene/tending";
import { mix } from "./atmosphere";
import { LivingPlant } from "./living-plant";

export type SceneMetrics = {
  width: number;
  height: number;
  horizonY: number;
  groundH: number;
  /** Pixels per degree of camera turn for the beds, as laid out. */
  ppd: number;
  fov: number;
  bedWidthDeg: number;
  /** Pixels per plant unit for a front-row plant, as laid out. */
  plantScale: number;
  /** Lowest place a bed sign's foot may stand, clear of the dock. */
  signTop: number;
  night: boolean;
  /** Width of a bed's front edge in pixels, as laid out. */
  bedWidth: number;
  /** Degrees between neighbouring beds. */
  spacing: number;
  /** Scene y of the back and front rows of a bed, as laid out. */
  yBack: number;
  yFront: number;
  /** The zoom this layout was drawn for: 1 across the garden, more at a topic. */
  layoutZoom: number;
};

/** A bed's dominant flower hue as hue, saturation, lightness. */
export type Hue = readonly [h: number, s: number, l: number];

/** How much narrower the back of a bed is drawn than its front. */
const BACK = 0.86;
const bedHalf = (metrics: SceneMetrics, depth: number) =>
  metrics.bedWidth * 0.5 * (BACK + (1 - BACK) * depth);

/** Where a plant stands in its bed, and how large it is drawn there. */
export function plantPlace(metrics: SceneMetrics, slot: PlantSlot) {
  return {
    x: slot.u * 2 * bedHalf(metrics, slot.depth) * 0.86,
    y: metrics.yBack + (metrics.yFront - metrics.yBack) * slot.depth,
    k: metrics.plantScale * (0.62 + 0.38 * slot.depth),
  };
}
export const plantBaseY = (metrics: SceneMetrics, depth: number) =>
  metrics.yBack + (metrics.yFront - metrics.yBack) * depth;
export const plantPx = (metrics: SceneMetrics, depth: number) =>
  metrics.plantScale * (0.62 + 0.38 * depth);

/**
 * Follows the camera without React: places an element for a bed as the camera
 * turns (theta) and steps closer (zoom). Only transform and opacity change.
 */
function useCamera(
  theta: MotionValue<number>,
  zoom: MotionValue<number>,
  apply: (theta: number, zoom: number) => void,
) {
  useLayoutEffect(() => {
    const update = () => apply(theta.get(), zoom.get());
    update();
    const a = theta.on("change", update);
    const b = zoom.on("change", update);
    return () => {
      a();
      b();
    };
  }, [theta, zoom, apply]);
}

function plantLabel(plant: ScenePlantModel) {
  const { seed, growth, marks, blooms } = plant;
  const parts = [`Thought: ${seed.title}`, describeGrowth(growth)];
  if (growth.lastWrittenAt)
    parts.push(
      `last written ${new Date(growth.lastWrittenAt).toLocaleDateString(
        undefined,
        {
          month: "short",
          day: "numeric",
        },
      )}`,
    );
  const notes = marks.length + blooms.length;
  if (notes)
    parts.push(`${notes} ${notes === 1 ? "tending note" : "tending notes"}`);
  return parts.join(", ");
}

const ScenePlant = memo(function ScenePlant({
  plant,
  angle,
  metrics,
  focused,
  interactive,
  onSelect,
}: {
  plant: ScenePlantModel;
  /** The bed's angle, to place this plant in the meadow-wide gust. */
  angle: number;
  metrics: SceneMetrics;
  focused: boolean;
  interactive: boolean;
  onSelect: (id: string) => void;
}) {
  const { genome, growth, slot, seed } = plant;
  const vigor = Math.round(growth.vigor * 4) / 4;
  const shape = useMemo(
    () => plantShape(genome, growth.stage, vigor),
    [genome, growth.stage, vigor],
  );
  const { x, y, k } = plantPlace(metrics, slot);
  const { bounds } = shape;
  const hasNew = plant.blooms.some((b) => b.isNew);
  const tended = plant.marks.length + plant.blooms.length > 0;
  const bloomed = plant.blooms.length > 0;
  const young = growth.stage === "seed" || growth.stage === "sprout";
  const style = {
    left: x + bounds.left * k,
    top: y + bounds.top * k,
    width: (bounds.right - bounds.left) * k,
    height: (-bounds.top + 6) * k,
    zIndex: Math.round(slot.depth * 1000),
    // A little per-plant jitter keeps neighbours from moving in lockstep.
    ...swayStyle(
      angle + slot.u * metrics.bedWidthDeg,
      genome.flex,
      genome.swayDelay * 0.08,
    ),
  } as React.CSSProperties;
  const art = (
    <span
      className="plant-art"
      style={{
        left: (-120 - bounds.left) * k,
        top: (-320 - bounds.top) * k,
        width: 240 * k,
        height: 332 * k,
      }}
    >
      <LivingPlant
        genome={genome}
        stage={growth.stage}
        vigor={vigor}
        night={metrics.night}
        detail={slot.depth > 0.45}
        shape={shape}
      />
    </span>
  );
  // Everything tending returns is light and vellum around the plant; the
  // plant itself is drawn only from the person's own writing.
  const width = (bounds.right - bounds.left) * k;
  const glow = Math.max(width * 1.9, 96 * k);
  const dressing = (
    <>
      <span
        className={`plant-mound${young ? " is-young" : ""}`}
        aria-hidden="true"
        style={{
          left: -bounds.left * k,
          width: Math.max(young ? 46 : 26, shape.shadow * 2.1) * k,
          height: Math.max(young ? 13 : 7, shape.shadow * 0.5) * k,
        }}
      />
      {young && (
        <span
          className="plant-marker"
          aria-hidden="true"
          style={{
            left: -bounds.left * k + Math.max(15 * k, 13),
            width: Math.max(9 * k, 10),
            height: Math.max(26 * k, 26),
          }}
        />
      )}
      {bloomed && (
        <>
          <span
            className="bloom-pool"
            aria-hidden="true"
            style={{
              left: -bounds.left * k,
              width: glow * 1.2,
              height: glow * 0.3,
            }}
          />
          <span
            className="bloom-light"
            aria-hidden="true"
            style={{
              left: -bounds.left * k,
              width: glow,
              height: glow,
              top: Math.min(glow * 0.5, (-bounds.top + 6) * k * 0.5),
            }}
          />
        </>
      )}
    </>
  );
  if (!interactive)
    return (
      <span className="scene-plant" style={style} aria-hidden="true">
        {dressing}
        {art}
      </span>
    );
  return (
    <button
      type="button"
      className={`scene-plant${focused ? " is-focused" : ""}${bloomed ? " has-bloom" : ""}${hasNew ? " has-new-bloom" : ""}`}
      style={style}
      data-plant={seed.id}
      aria-label={plantLabel(plant)}
      aria-pressed={focused}
      onClick={() => onSelect(seed.id)}
    >
      {dressing}
      {art}
      {tended && (
        <span
          className={`plant-tend${bloomed ? " is-bloom" : ""}`}
          aria-hidden="true"
        >
          <span>❦</span>
        </span>
      )}
    </button>
  );
});

function Threads({
  bed,
  metrics,
  tending,
}: {
  bed: SceneBedModel;
  metrics: SceneMetrics;
  tending: Tending;
}) {
  const positions = new Map<string, { x: number; y: number }>();
  for (const p of bed.plants) {
    const shape: PlantShape = plantShape(
      p.genome,
      p.growth.stage,
      Math.round(p.growth.vigor * 4) / 4,
    );
    const { x, y, k } = plantPlace(metrics, p.slot);
    positions.set(p.seed.id, { x, y: y - shape.height * k * 0.8 });
  }
  const threads = threadsFor(tending, new Set(positions.keys()));
  if (!threads.length) return null;
  const r = Math.max(2.4, metrics.plantScale * 3.2);
  return (
    <svg className="scene-threads" aria-hidden="true">
      {threads.map((t) => {
        const a = positions.get(t.from)!;
        const b = positions.get(t.to)!;
        const mx = (a.x + b.x) / 2;
        // A thread hangs between two plants like a line of gossamer.
        const my = Math.max(a.y, b.y) + Math.abs(a.x - b.x) * 0.16 + 10;
        const d = `M${a.x.toFixed(1)},${a.y.toFixed(1)}Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
        return (
          <g key={t.id} className={`scene-thread thread-${t.kind}`}>
            <path className="thread-under" d={d} />
            <path className="thread-line" d={d} />
            <circle cx={a.x} cy={a.y} r={r} />
            <circle cx={b.x} cy={b.y} r={r} />
          </g>
        );
      })}
    </svg>
  );
}

function roundedOutline(points: [number, number][], radii: number[]) {
  let d = "";
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const prev = points[(i + n - 1) % n];
    const next = points[(i + 1) % n];
    const toward = (q: [number, number]) => {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const r = Math.min(radii[i], len / 2);
      return [
        p[0] + ((q[0] - p[0]) / len) * r,
        p[1] + ((q[1] - p[1]) / len) * r,
      ];
    };
    const a = toward(prev);
    const b = toward(next);
    d += `${i ? "L" : "M"}${a[0].toFixed(1)},${a[1].toFixed(1)}Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`;
  }
  return `${d}Z`;
}

/**
 * The bed itself: tilled soil inside a border of field stones, a mown edge,
 * and low edging flowers in the bed's own hue. Drawn once per layout; it only
 * ever moves with its bed.
 */
const BedGround = memo(function BedGround({
  bed,
  metrics,
  palette,
  hue: [h, sat, l],
}: {
  bed: SceneBedModel;
  metrics: SceneMetrics;
  palette: Palette;
  hue: Hue;
}) {
  const art = useMemo(() => {
    const random = seededRandom(hashString(`bed-ground:${bed.plot.id}`));
    const { yBack, yFront, bedWidth } = metrics;
    const deep = yFront - yBack;
    const top = yBack - deep * 0.1;
    const bottom = yFront + deep * 0.13;
    const depthAt = (y: number) => (y - yBack) / deep;
    const halfAt = (y: number) => bedHalf(metrics, depthAt(y)) * 1.02;
    const outline = (grow: number) =>
      roundedOutline(
        [
          [-halfAt(top) - grow, top - grow * 0.5],
          [halfAt(top) + grow, top - grow * 0.5],
          [halfAt(bottom) + grow, bottom + grow * 0.6],
          [-halfAt(bottom) - grow, bottom + grow * 0.6],
        ],
        [deep * 0.3, deep * 0.3, deep * 0.5, deep * 0.5],
      );
    const unit = bedWidth / 34;

    // Stones round the edge: small along the back, larger at the front.
    const stones: {
      x: number;
      y: number;
      rx: number;
      ry: number;
      tone: number;
      turn: number;
    }[] = [];
    const edge = (
      from: [number, number],
      to: [number, number],
      size0: number,
      size1: number,
    ) => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      let travelled = 0;
      while (travelled < length) {
        const t = travelled / length;
        const size = lerp(size0, size1, t) * lerp(0.6, 1.5, random());
        stones.push({
          x: lerp(from[0], to[0], t) + (random() - 0.5) * size * 0.3,
          y: lerp(from[1], to[1], t) + (random() - 0.5) * size * 0.24,
          rx: size * 0.58,
          ry: size * lerp(0.28, 0.44, random()),
          tone: random(),
          turn: (random() - 0.5) * 24,
        });
        travelled += size * 0.92;
      }
    };
    const inset = deep * 0.16;
    const bl: [number, number] = [-halfAt(top) + inset * 0.6, top];
    const br: [number, number] = [halfAt(top) - inset * 0.6, top];
    const fl: [number, number] = [-halfAt(bottom) + inset * 1.5, bottom];
    const fr: [number, number] = [halfAt(bottom) - inset * 1.5, bottom];
    const sl0: [number, number] = [-halfAt(top + inset), top + inset];
    const sl1: [number, number] = [
      -halfAt(bottom - inset * 1.4),
      bottom - inset * 1.4,
    ];
    edge(bl, br, unit * 0.55, unit * 0.55);
    edge(sl0, sl1, unit * 0.6, unit * 0.95);
    edge([-sl0[0], sl0[1]], [-sl1[0], sl1[1]], unit * 0.6, unit * 0.95);
    edge(fl, fr, unit, unit);
    // The rounded front corners.
    for (const side of [-1, 1])
      for (const t of [0.25, 0.6]) {
        stones.push({
          x: lerp(sl1[0], fl[0], t) * -side + side * unit * 0.1,
          y: lerp(sl1[1], fl[1], t) + unit * 0.12,
          rx: unit * 0.56,
          ry: unit * 0.36,
          tone: random(),
          turn: (random() - 0.5) * 24,
        });
      }
    stones.sort((a, b) => a.y - b.y);

    // Furrows across the soil.
    const furrows = [0.22, 0.48, 0.74].map((t) => {
      const y = lerp(top, bottom, t);
      const half = halfAt(y) * lerp(0.8, 0.92, random());
      const sag = deep * lerp(0.03, 0.07, random());
      return `M${(-half).toFixed(1)},${y.toFixed(1)}C${(-half * 0.4).toFixed(1)},${(y + sag).toFixed(1)} ${(half * 0.3).toFixed(1)},${(y - sag * 0.4).toFixed(1)} ${half.toFixed(1)},${(y + sag * 0.3).toFixed(1)}`;
    });

    // Edging flowers in the bed's hue: cushions along the border, thickest
    // at the front corners.
    const tufts: { x: number; y: number; r: number; dots: number[][] }[] = [];
    const tuft = (x: number, y: number, r: number) => {
      const dots = Array.from({ length: 7 + Math.floor(random() * 6) }, () => [
        (random() - 0.5) * r * 2.3,
        -random() * r * 1.05,
        r * lerp(0.13, 0.22, random()),
        random(),
      ]);
      tufts.push({ x, y, r, dots });
    };
    const frontCount = Math.round(lerp(9, 13, random()));
    for (let i = 0; i < frontCount; i++) {
      const t = (i + random() * 0.7) / frontCount;
      const pull = Math.pow(Math.abs(t - 0.5) * 2, 0.6) * Math.sign(t - 0.5);
      const y = bottom - inset * lerp(0.75, 1.5, random());
      tuft(pull * halfAt(y) * 0.9, y, unit * lerp(0.75, 1.15, random()));
    }
    for (const side of [-1, 1])
      for (let i = 0; i < 5; i++) {
        const t = (i + random()) / 5;
        const y = lerp(top + inset * 1.2, bottom - inset * 2, t);
        tuft(side * halfAt(y) * 0.92, y, unit * lerp(0.4, 0.9, t));
      }
    for (let i = 0; i < 7; i++) {
      const y = top + inset * lerp(0.7, 1.1, random());
      tuft(
        (random() - 0.5) * 1.7 * halfAt(y),
        y,
        unit * lerp(0.32, 0.5, random()),
      );
    }
    tufts.sort((a, b) => a.y - b.y);

    // Merge the many small shapes into a handful of paths: a bed mounts while
    // the camera turns, so it must stay light.
    const oval = (x: number, y: number, rx: number, ry: number, turn = 0) => {
      const c = Math.cos((turn * Math.PI) / 180) * rx;
      const sn = Math.sin((turn * Math.PI) / 180) * rx;
      const arc = `A${rx.toFixed(1)} ${ry.toFixed(1)} ${turn.toFixed(0)} 1 0 `;
      return `M${(x - c).toFixed(1)} ${(y - sn).toFixed(1)}${arc}${(x + c).toFixed(1)} ${(y + sn).toFixed(1)}${arc}${(x - c).toFixed(1)} ${(y - sn).toFixed(1)}Z`;
    };
    const stonePaths = ["", "", "", ""];
    for (const stone of stones)
      stonePaths[Math.min(3, Math.floor(stone.tone * 4))] += oval(
        stone.x,
        stone.y,
        stone.rx,
        stone.ry,
        stone.turn,
      );
    let cushions = "";
    const petals = ["", "", ""];
    for (const t of tufts) {
      cushions += oval(t.x, t.y - t.r * 0.34, t.r * 1.25, t.r * 0.7);
      for (const [dx, dy, r, tone] of t.dots)
        petals[tone > 0.66 ? 2 : tone > 0.33 ? 1 : 0] += oval(
          t.x + dx,
          t.y + dy,
          r,
          r,
        );
    }
    return {
      mown: outline(unit * 0.55),
      soil: outline(0),
      stonePaths,
      furrows,
      cushions,
      petals,
      top,
      bottom,
      unit,
    };
  }, [bed.plot.id, metrics]);

  const night = palette.night;
  const hue = (dl: number) =>
    `hsl(${h} ${night ? sat * 0.5 : sat}% ${Math.max(0, Math.min(96, (night ? l * 0.5 : l) + dl))}%)`;
  const id = `bed${hashString(bed.plot.id).toString(36)}`;
  const leaf = palette.grass[Math.min(4, palette.grass.length - 1)];
  const stoneTones = [
    mix(palette.stone[0], palette.stone[1], 0.18),
    mix(palette.stone[0], palette.stone[1], 0.42),
    mix(palette.stone[0], palette.stone[1], 0.66),
    mix(mix(palette.stone[0], palette.stone[1], 0.5), palette.grass[3], 0.35),
  ];
  return (
    <svg className="bed-ground" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}-soil`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          x2="0"
          y1={art.top}
          y2={art.bottom}
        >
          <stop
            offset="0"
            stopColor={mix(palette.soil[0], palette.mist, 0.3)}
          />
          <stop offset=".45" stopColor={palette.soil[0]} />
          <stop offset="1" stopColor={palette.soil[1]} />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop
            offset="0"
            stopColor="#fffdf2"
            stopOpacity={night ? 0.14 : 0.5}
          />
          <stop
            offset=".6"
            stopColor="#fffdf2"
            stopOpacity={night ? 0.06 : 0.22}
          />
          <stop offset="1" stopColor="#fffdf2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d={art.mown}
        fill={mix(palette.grass[2], palette.light, 0.16)}
        opacity=".55"
      />
      <path
        d={art.soil}
        fill={palette.stone[1]}
        opacity=".55"
        transform={`translate(0 ${(art.unit * 0.22).toFixed(1)})`}
      />
      <path d={art.soil} fill={`url(#${id}-soil)`} />
      <g
        fill="none"
        stroke={mix(palette.soil[1], "#000000", 0.35)}
        strokeWidth={Math.max(1, art.unit * 0.1)}
        strokeLinecap="round"
        opacity=".34"
      >
        {art.furrows.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {art.stonePaths.map(
        (d, i) => d && <path key={i} d={d} fill={stoneTones[i]} />,
      )}
      {/* In a sparse bed each plant stands in its own patch of sun. */}
      {bed.plants
        .filter(
          (p) =>
            bed.plants.length <= 4 ||
            p.growth.stage === "seed" ||
            p.growth.stage === "sprout",
        )
        .map((p) => {
          const { x, y, k } = plantPlace(metrics, p.slot);
          return (
            <ellipse
              key={p.seed.id}
              cx={x.toFixed(1)}
              cy={(y + 2 * k).toFixed(1)}
              rx={Math.max(64 * k, 34).toFixed(1)}
              ry={Math.max(17 * k, 9).toFixed(1)}
              fill={`url(#${id}-sun)`}
            />
          );
        })}
      <path d={art.cushions} fill={leaf} />
      {art.petals.map(
        (d, i) => d && <path key={i} d={d} fill={hue([-10, 0, 12][i])} />,
      )}
    </svg>
  );
});

export const SceneBed = memo(function SceneBed({
  bed,
  theta,
  zoom,
  metrics,
  palette,
  hue,
  focusId,
  interactive,
  showThreads,
  tending,
  onPlant,
}: {
  bed: SceneBedModel;
  theta: MotionValue<number>;
  zoom: MotionValue<number>;
  metrics: SceneMetrics;
  palette: Palette;
  hue: Hue;
  focusId: string;
  interactive: boolean;
  showThreads: boolean;
  tending: Tending;
  onPlant: (id: string) => void;
}) {
  const band = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLSpanElement>(null);
  const { width, horizonY, ppd, spacing, layoutZoom } = metrics;
  const angle = bed.angle;
  const place = useCallback(
    (t: number, z: number) => {
      const rel = wrap(angle - t);
      const scale = z / layoutZoom;
      const x = width / 2 + rel * (ppd / layoutZoom) * z;
      if (band.current) {
        band.current.style.transform = `translate(${x.toFixed(1)}px, ${(horizonY * (1 - scale)).toFixed(1)}px) scale(${scale.toFixed(4)})`;
        band.current.style.opacity = bedOpacity(rel, spacing).toFixed(3);
      }
      // Beds the camera is not facing fall back into the haze.
      if (veil.current)
        veil.current.style.opacity = ((1 - facing(rel, spacing)) * 0.5).toFixed(
          3,
        );
    },
    [angle, width, horizonY, ppd, spacing, layoutZoom],
  );
  useCamera(theta, zoom, place);
  const tall = metrics.plantScale * 300;
  return (
    <div
      ref={band}
      className="scene-band scene-bed"
      role={interactive ? "group" : undefined}
      aria-label={interactive ? `Topic: ${bed.plot.name}` : undefined}
    >
      <BedGround bed={bed} metrics={metrics} palette={palette} hue={hue} />
      {bed.plants.map((p) => (
        <ScenePlant
          key={p.seed.id}
          plant={p}
          angle={bed.angle}
          metrics={metrics}
          focused={focusId === p.seed.id}
          interactive={interactive}
          onSelect={onPlant}
        />
      ))}
      {showThreads && <Threads bed={bed} metrics={metrics} tending={tending} />}
      <span
        ref={veil}
        className="bed-veil"
        aria-hidden="true"
        style={{
          left: -metrics.bedWidth * 0.66,
          width: metrics.bedWidth * 1.32,
          top: metrics.yBack - tall * 0.72,
          height:
            metrics.yFront -
            metrics.yBack +
            tall * 0.72 +
            metrics.bedWidth * 0.1,
          background: `radial-gradient(ellipse 50% 50% at 50% 50%, ${mix(palette.mist, palette.mist, 0, 0.92)} 0%, ${mix(palette.mist, palette.mist, 0, 0.8)} 40%, ${mix(palette.mist, palette.mist, 0, 0.36)} 72%, ${mix(palette.mist, palette.mist, 0, 0)} 100%)`,
        }}
      />
    </div>
  );
});

/** The paper sign at the front of a bed, above the foreground grass. */
export function BedSign({
  bed,
  theta,
  zoom,
  metrics,
  hue: [h, sat, l],
  current,
  interactive,
  onSelect,
  onMore,
}: {
  bed: SceneBedModel;
  theta: MotionValue<number>;
  zoom: MotionValue<number>;
  metrics: SceneMetrics;
  hue: Hue;
  current: boolean;
  interactive: boolean;
  onSelect: (id: string) => void;
  /** Opens the pages for this topic, where resting thoughts live. */
  onMore?: (id: string) => void;
}) {
  const band = useRef<HTMLDivElement>(null);
  const {
    width,
    horizonY,
    ppd,
    spacing,
    layoutZoom,
    bedWidth,
    yFront,
    yBack,
    signTop,
  } = metrics;
  const signHeight = useRef(76);
  const angle = bed.angle;
  const place = useCallback(
    (t: number, z: number) => {
      if (!band.current) return;
      const rel = wrap(angle - t);
      const k = z / layoutZoom;
      const x = width / 2 + (rel * ppd - bedWidth * 0.27) * k;
      const front = horizonY + (yFront - horizonY) * k;
      // The sign stands in the grass in front of the bed, clear of its
      // stones and edging flowers.
      const edge = front + ((yFront - yBack) * 0.13 + bedWidth * 0.03) * k;
      const foot = Math.min(edge + signHeight.current + 8, signTop);
      band.current.style.transform = `translate(${x.toFixed(1)}px, ${foot.toFixed(1)}px)`;
      band.current.style.opacity = bedOpacity(rel, spacing).toFixed(3);
    },
    [
      angle,
      width,
      horizonY,
      ppd,
      spacing,
      layoutZoom,
      bedWidth,
      yFront,
      yBack,
      signTop,
    ],
  );
  useLayoutEffect(() => {
    const post = band.current?.firstElementChild as HTMLElement | null;
    if (post) signHeight.current = post.offsetHeight;
  });
  useCamera(theta, zoom, place);
  const label = (
    <>
      <span
        className="bed-sign-hue"
        aria-hidden="true"
        style={{
          background: `hsl(${h} ${metrics.night ? sat * 0.6 : sat}% ${metrics.night ? l * 0.7 : l}%)`,
        }}
      />
      {bed.plants.some((p) => p.blooms.length > 0) && (
        <span className="bed-sign-bloom" aria-hidden="true">
          ❦
        </span>
      )}
      <span className="bed-sign-name">{bed.plot.name}</span>
      <span className="bed-sign-count">
        {bed.total === 0
          ? "Ready for a first thought"
          : `${bed.total} ${bed.total === 1 ? "thought" : "thoughts"}`}
      </span>
    </>
  );
  return (
    <div ref={band} className="scene-band scene-band-signs">
      <span className="bed-sign-post">
        <span className="bed-sign-wrap">
          {interactive ? (
            <button
              type="button"
              className="bed-sign"
              aria-current={current ? "location" : undefined}
              onClick={() => onSelect(bed.plot.id)}
            >
              {label}
            </button>
          ) : (
            <span className="bed-sign" aria-hidden="true">
              {label}
            </span>
          )}
          {interactive && onMore && bed.resting > 0 && (
            <button
              type="button"
              className="bed-sign-more"
              onClick={() => onMore(bed.plot.id)}
            >
              +{bed.resting} more in Pages
              <span className="visually-hidden"> for {bed.plot.name}</span>
            </button>
          )}
        </span>
      </span>
    </div>
  );
}
