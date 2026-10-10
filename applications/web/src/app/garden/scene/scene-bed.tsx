"use client";
import { m, useTransform, type MotionValue } from "motion/react";
import { memo, useMemo } from "react";
import { plantY, rowParallax, wrap } from "@/lib/garden/scene/camera";
import { describeGrowth } from "@/lib/garden/scene/growth";
import type { SceneBedModel, ScenePlantModel } from "@/lib/garden/scene/model";
import { plantShape, type PlantShape } from "@/lib/garden/scene/plant-geometry";
import { threadsFor, type Tending } from "@/lib/garden/scene/tending";
import { LivingPlant } from "./living-plant";

export type SceneMetrics = {
  width: number;
  height: number;
  horizonY: number;
  groundH: number;
  ppd: number;
  fov: number;
  bedWidthDeg: number;
  /** Pixels per plant unit for a front-row plant. */
  plantScale: number;
  /** Where bed signs stand, clear of the dock. */
  signTop: number;
  night: boolean;
};

const BANDS = [
  { max: 0.36, depth: 0.2 },
  { max: 0.68, depth: 0.52 },
  { max: 1.01, depth: 0.85 },
];

export const plantBaseY = (metrics: SceneMetrics, depth: number) =>
  metrics.horizonY + metrics.groundH * plantY(depth);
export const plantPx = (metrics: SceneMetrics, depth: number) =>
  metrics.plantScale * (0.42 + 0.58 * depth);

function Band({
  angle,
  factor,
  theta,
  metrics,
  className,
  children,
}: {
  angle: number;
  factor: number;
  theta: MotionValue<number>;
  metrics: SceneMetrics;
  className: string;
  children: React.ReactNode;
}) {
  const x = useTransform(
    theta,
    (t) => metrics.width / 2 + wrap(angle - t) * metrics.ppd * factor,
  );
  return (
    <m.div className={className} style={{ x }}>
      {children}
    </m.div>
  );
}

function plantLabel(plant: ScenePlantModel) {
  const { seed, growth, marks, blooms } = plant;
  const parts = [`Thought: ${seed.title}`, describeGrowth(growth)];
  if (growth.lastWrittenAt)
    parts.push(
      `last written ${new Date(growth.lastWrittenAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`,
    );
  const notes = marks.length + blooms.length;
  if (notes) parts.push(`${notes} ${notes === 1 ? "tending note" : "tending notes"}`);
  return parts.join(", ");
}

const ScenePlant = memo(function ScenePlant({
  plant,
  metrics,
  focused,
  interactive,
  onSelect,
}: {
  plant: ScenePlantModel;
  metrics: SceneMetrics;
  focused: boolean;
  interactive: boolean;
  onSelect: (id: string) => void;
}) {
  const { genome, growth, slot, seed } = plant;
  const vigor = Math.round(growth.vigor * 4) / 4;
  const shape = useMemo(() => plantShape(genome, growth.stage, vigor), [genome, growth.stage, vigor]);
  const k = plantPx(metrics, slot.depth);
  const x = slot.u * metrics.bedWidthDeg * metrics.ppd;
  const y = plantBaseY(metrics, slot.depth);
  const { bounds } = shape;
  const hasNew = plant.blooms.some((b) => b.isNew);
  const tended = plant.marks.length + plant.blooms.length > 0;
  const style = {
    left: x + bounds.left * k,
    top: y + bounds.top * k,
    width: (bounds.right - bounds.left) * k,
    height: (-bounds.top + 6) * k,
    zIndex: Math.round(slot.depth * 1000),
    "--flex": genome.flex.toFixed(2),
    "--sway": `${genome.swaySeconds.toFixed(2)}s`,
    "--sway-delay": `${genome.swayDelay.toFixed(2)}s`,
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
        detail={slot.depth > 0.3}
        shape={shape}
      />
    </span>
  );
  if (!interactive)
    return (
      <span className="scene-plant" style={style} aria-hidden="true">
        {art}
      </span>
    );
  return (
    <button
      type="button"
      className={`scene-plant${focused ? " is-focused" : ""}${hasNew ? " has-new-bloom" : ""}`}
      style={style}
      data-plant={seed.id}
      aria-label={plantLabel(plant)}
      aria-pressed={focused}
      onClick={() => onSelect(seed.id)}
    >
      {art}
      {tended && (
        <span className="plant-tend" aria-hidden="true">
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
    const shape: PlantShape = plantShape(p.genome, p.growth.stage, Math.round(p.growth.vigor * 4) / 4);
    const k = plantPx(metrics, p.slot.depth);
    positions.set(p.seed.id, {
      x: p.slot.u * metrics.bedWidthDeg * metrics.ppd,
      y: plantBaseY(metrics, p.slot.depth) - shape.height * k * 0.82,
    });
  }
  const threads = threadsFor(tending, new Set(positions.keys()));
  if (!threads.length) return null;
  return (
    <svg className="scene-threads" aria-hidden="true">
      {threads.map((t) => {
        const a = positions.get(t.from)!;
        const b = positions.get(t.to)!;
        const mx = (a.x + b.x) / 2;
        const my = Math.min(a.y, b.y) - Math.abs(a.x - b.x) * 0.18 - 18;
        return (
          <g key={t.id} className={`scene-thread thread-${t.kind}`}>
            <path d={`M${a.x},${a.y}Q${mx},${my} ${b.x},${b.y}`} />
            <circle cx={a.x} cy={a.y} r="3" />
            <circle cx={b.x} cy={b.y} r="3" />
          </g>
        );
      })}
    </svg>
  );
}

export const SceneBed = memo(function SceneBed({
  bed,
  theta,
  metrics,
  focusId,
  interactive,
  showThreads,
  tending,
  onPlant,
}: {
  bed: SceneBedModel;
  theta: MotionValue<number>;
  metrics: SceneMetrics;
  focusId: string;
  interactive: boolean;
  showThreads: boolean;
  tending: Tending;
  onPlant: (id: string) => void;
}) {
  const bands = BANDS.map(() => [] as ScenePlantModel[]);
  for (const p of bed.plants) bands[BANDS.findIndex((b) => p.slot.depth < b.max)].push(p);
  const clearing = plantPx(metrics, 0.5) * 120;
  return (
    <>
      {bands.map((plants, i) => (
        <Band
          key={i}
          angle={bed.angle}
          factor={rowParallax(BANDS[i].depth)}
          theta={theta}
          metrics={metrics}
          className={`scene-band scene-band-${i}`}
        >
          {i === 0 && (
            <span
              className="bed-clearing"
              aria-hidden="true"
              style={{
                left: -metrics.bedWidthDeg * metrics.ppd * 0.58,
                width: metrics.bedWidthDeg * metrics.ppd * 1.16,
                top: plantBaseY(metrics, 0.02),
                height: plantBaseY(metrics, 1.02) - plantBaseY(metrics, 0.02) + clearing * 0.1,
              }}
            />
          )}
          {plants.map((p) => (
            <ScenePlant
              key={p.seed.id}
              plant={p}
              metrics={metrics}
              focused={focusId === p.seed.id}
              interactive={interactive}
              onSelect={onPlant}
            />
          ))}
          {i === 1 && showThreads && <Threads bed={bed} metrics={metrics} tending={tending} />}
        </Band>
      ))}
    </>
  );
});

/** The paper sign at the front of a bed, above the foreground grass. */
export function BedSign({
  bed,
  theta,
  metrics,
  current,
  interactive,
  onSelect,
}: {
  bed: SceneBedModel;
  theta: MotionValue<number>;
  metrics: SceneMetrics;
  current: boolean;
  interactive: boolean;
  onSelect: (id: string) => void;
}) {
  const label = (
    <>
      <span className="bed-sign-name">{bed.plot.name}</span>
      <span className="bed-sign-count">
        {bed.total === 0
          ? "Ready for a first thought"
          : `${bed.total} ${bed.total === 1 ? "thought" : "thoughts"}`}
      </span>
    </>
  );
  return (
    <Band
      angle={bed.angle}
      factor={rowParallax(1)}
      theta={theta}
      metrics={metrics}
      className="scene-band scene-band-signs"
    >
      <span className="bed-sign-post" style={{ top: metrics.signTop }}>
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
      </span>
    </Band>
  );
}
