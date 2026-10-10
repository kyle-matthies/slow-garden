"use client";
import { memo, useId, useMemo } from "react";
import type { Genome } from "@/lib/garden/scene/genome";
import type { GrowthStage } from "@/lib/garden/scene/growth";
import { seededRandom } from "@/lib/garden/scene/hash";
import {
  PLANT_VIEWBOX,
  bellFloret,
  budPath,
  cupPetal,
  fringedFloret,
  peaFloret,
  petalAngles,
  petalVeins,
  plantShape,
  racemePoints,
  rayPetal,
  round1,
  sepalPath,
  type Head,
  type PlantShape,
} from "@/lib/garden/scene/plant-geometry";
import type { HSL } from "@/lib/garden/scene/species";

type Tone = (c: HSL, dl?: number, ds?: number, alpha?: number) => string;

function toneFor(night: boolean, pressed: boolean): Tone {
  return ([h, s, l], dl = 0, ds = 0, alpha = 1) => {
    let light = Math.max(0, Math.min(100, l + dl));
    let sat = Math.max(0, Math.min(100, s + ds));
    if (night) {
      light *= 0.6;
      sat *= 0.62;
    }
    if (pressed) {
      // Dried pigment: a little duller, a little warmer.
      sat *= 0.72;
      light = light * 0.94 + 4;
    }
    return `hsl(${h.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%${alpha < 1 ? ` / ${alpha}` : ""})`;
  };
}

const vb = `${PLANT_VIEWBOX.x} ${PLANT_VIEWBOX.y} ${PLANT_VIEWBOX.width} ${PLANT_VIEWBOX.height}`;

/**
 * A procedural plant drawn in SVG. Identity (species, colour, form) comes from
 * the thought's genome; size and maturity come from the person's own tending.
 * Purely decorative: the surrounding button carries the accessible name.
 */
export const LivingPlant = memo(function LivingPlant({
  genome,
  stage,
  vigor,
  night = false,
  detail = true,
  shape: given,
  fit = false,
  pressed = false,
}: {
  genome: Genome;
  stage: GrowthStage;
  vigor: number;
  night?: boolean;
  /** Fewer petal veins and no texture filter for distant or tiny plants. */
  detail?: boolean;
  /** Precomputed geometry, when the caller already needed it for layout. */
  shape?: PlantShape;
  /** Crop the view to the plant itself, as for a specimen. */
  fit?: boolean;
  /** Flattened, face-on and dried, as a pressed specimen in the Cabinet. */
  pressed?: boolean;
}) {
  const raw = useId();
  const id = `p${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const vigorStep = Math.round(vigor * 4) / 4;
  const computed = useMemo(
    () => (given ? null : plantShape(genome, stage, vigorStep)),
    [given, genome, stage, vigorStep],
  );
  const shape = given ?? computed!;
  const tone = toneFor(night, pressed);
  const { species, colour } = genome;
  const stemC = species.stem;
  const pale = colour[2] > 88;
  let viewBox = vb;
  if (fit) {
    const { left, right, top } = shape.bounds;
    const h = Math.max(120, -top + 24);
    const w = Math.max(right - left + 24, h * 0.55);
    viewBox = `${round1((left + right) / 2 - w / 2)} ${round1(12 - h)} ${round1(w)} ${round1(h)}`;
  }
  return (
    <svg
      className="living-plant"
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMax meet"
    >
      <defs>
        <radialGradient id={`${id}-shadow`}>
          <stop
            offset="0"
            stopColor={night ? "rgba(0,0,0,.45)" : "rgba(28,40,18,.34)"}
          />
          <stop offset="1" stopColor="rgba(28,40,18,0)" />
        </radialGradient>
        <linearGradient id={`${id}-stem`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={tone(stemC, -10)} />
          <stop offset=".45" stopColor={tone(stemC, 9)} />
          <stop offset="1" stopColor={tone(stemC, -16)} />
        </linearGradient>
        <linearGradient id={`${id}-leaf`} x1="0" x2="1" y1="0" y2=".25">
          <stop offset="0" stopColor={tone(stemC, -6, 4)} />
          <stop offset=".5" stopColor={tone(stemC, 7, 6)} />
          <stop offset="1" stopColor={tone(stemC, -14, 2)} />
        </linearGradient>
        <radialGradient id={`${id}-petal`} cx=".5" cy="1" fx=".5" fy="1" r="1">
          <stop
            offset="0"
            stopColor={pale ? tone([52, 46, 82]) : tone(colour, -16, 8)}
          />
          <stop offset=".34" stopColor={tone(colour, -3)} />
          <stop offset="1" stopColor={tone(colour, pale ? 1 : 6, -4)} />
        </radialGradient>
        <radialGradient id={`${id}-disk`} cx=".4" cy=".35" r=".75">
          <stop offset="0" stopColor={tone(species.centre, 14)} />
          <stop offset=".7" stopColor={tone(species.centre, -2)} />
          <stop offset="1" stopColor={tone(species.centre, -18)} />
        </radialGradient>
        <linearGradient id={`${id}-bell`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={tone(colour, -12, 6)} />
          <stop offset=".7" stopColor={tone(colour, 2)} />
          <stop offset="1" stopColor={tone(colour, 10, -6)} />
        </linearGradient>
        <linearGradient id={`${id}-bud`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={tone(stemC, -6)} />
          <stop offset=".5" stopColor={tone(stemC, 10)} />
          <stop offset="1" stopColor={tone(stemC, -12)} />
        </linearGradient>
        {detail && (
          <filter id={`${id}-tex`} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.85"
              numOctaves="2"
              seed={genome.seed % 997}
              result="n"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="n"
              scale="1.4"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        )}
      </defs>
      <ellipse
        cx="0"
        cy="2"
        rx={shape.shadow}
        ry={shape.shadow * 0.24}
        fill={`url(#${id}-shadow)`}
      />
      {stage === "seed" && (
        <ellipse
          cx="0"
          cy="1"
          rx="9"
          ry="3.2"
          fill={tone([30, 26, 34], 0)}
          opacity=".7"
        />
      )}
      <g className="plant-leaves">
        {shape.leaves.map((leaf, i) => (
          <g
            key={i}
            transform={`translate(${round1(leaf.at[0])} ${round1(leaf.at[1])}) rotate(${round1(leaf.angle)})`}
          >
            <path d={leaf.d} fill={`url(#${id}-leaf)`} />
            <path
              d={leaf.rib}
              fill="none"
              stroke={
                leaf.kind === "pinnate"
                  ? tone(stemC, -8)
                  : tone(stemC, 18, 0, 0.55)
              }
              strokeWidth={leaf.kind === "pinnate" ? 0.9 : 0.7}
              strokeLinecap="round"
            />
          </g>
        ))}
      </g>
      {shape.branches.map((d, i) => (
        <path key={i} d={d} fill={`url(#${id}-stem)`} />
      ))}
      <path d={shape.stem} fill={`url(#${id}-stem)`} />
      <g filter={detail ? `url(#${id}-tex)` : undefined}>
        {shape.heads.map((head, i) => (
          <HeadShape
            key={i}
            head={
              pressed
                ? { ...head, foreshorten: 1, tilt: head.tilt * 0.25 }
                : head
            }
            genome={genome}
            id={id}
            tone={tone}
            index={i}
            detail={detail}
          />
        ))}
      </g>
    </svg>
  );
});

function HeadShape({
  head,
  genome,
  id,
  tone,
  index,
  detail,
}: {
  head: Head;
  genome: Genome;
  id: string;
  tone: Tone;
  index: number;
  detail: boolean;
}) {
  const { species, colour } = genome;
  const R = head.radius;
  const at = `translate(${round1(head.at[0])} ${round1(head.at[1])})`;
  const random = seededRandom(genome.seed + index * 7919);

  if (head.kind === "bud") {
    if (head.spine) {
      const points = racemePoints(
        head.spine.from,
        head.spine.to,
        species.form === "plume" ? 1 : 8,
      );
      if (species.form === "plume")
        return (
          <path
            d={`M${round1(head.spine.from[0])},${round1(head.spine.from[1])}L${round1(head.spine.to[0])},${round1(head.spine.to[1])}`}
            stroke={tone(species.stem, 6)}
            strokeWidth={R * 0.5}
            strokeLinecap="round"
          />
        );
      return (
        <g>
          {points.map(({ at: p, t }, i) => (
            <ellipse
              key={i}
              cx={p[0] + (i % 2 ? 2.4 : -2.4) * (1 - t)}
              cy={p[1]}
              rx={R * 0.32 * (1 - t * 0.5)}
              ry={R * 0.46 * (1 - t * 0.5)}
              fill={i < 3 ? tone(colour, -8, -10) : `url(#${id}-bud)`}
            />
          ))}
        </g>
      );
    }
    return (
      <g transform={`${at} rotate(${round1(head.tilt)})`}>
        <path d={budPath(R)} fill={`url(#${id}-bud)`} />
        <path
          d={budPath(R * 0.62)}
          transform={`translate(0 ${round1(-R * 0.62)})`}
          fill={tone(colour, -6, 0, 0.88)}
        />
        <path d={sepalPath(R * 1.05)} fill={tone(species.stem, -10)} />
      </g>
    );
  }

  switch (species.form) {
    case "ray": {
      const narrow = species.id === "chamomile";
      const width = R * (narrow ? 0.2 : 0.44);
      const angles = petalAngles(genome.petals, genome.seed + index);
      // Back petals first, so the near ones overlap them.
      const ordered = [...angles].sort(
        (a, b) => Math.cos((b * Math.PI) / 180) - Math.cos((a * Math.PI) / 180),
      );
      const petal = rayPetal(R, width, !narrow);
      const veins = petalVeins(R, width);
      const disk = R * (narrow ? 0.32 : 0.22);
      return (
        <g
          transform={`${at} rotate(${round1(head.tilt)}) scale(1 ${round1(head.foreshorten)})`}
        >
          {ordered.map((a, i) => {
            const back = Math.cos((a * Math.PI) / 180) > 0.25;
            return (
              <g key={i} transform={`rotate(${a})`}>
                <path d={petal} fill={`url(#${id}-petal)`} />
                {detail && !narrow && (
                  <path
                    d={veins}
                    fill="none"
                    stroke={tone(colour, -24, 0, 0.22)}
                    strokeWidth=".5"
                  />
                )}
                {back && <path d={petal} fill="rgba(30,30,20,.07)" />}
              </g>
            );
          })}
          <ellipse
            cx="0"
            cy={narrow ? -disk * 0.25 : 0}
            rx={disk}
            ry={disk * (narrow ? 1.05 : 1)}
            fill={`url(#${id}-disk)`}
          />
          {detail &&
            Array.from({ length: 14 }, (_, i) => {
              const a = (i / 14) * Math.PI * 2;
              return (
                <circle
                  key={i}
                  cx={round1(Math.cos(a) * disk * 0.66)}
                  cy={round1(
                    Math.sin(a) * disk * 0.66 - (narrow ? disk * 0.25 : 0),
                  )}
                  r={round1(disk * 0.11)}
                  fill={tone(species.centre, -22)}
                />
              );
            })}
        </g>
      );
    }
    case "cup": {
      const poppy = species.id === "poppy";
      const angles = petalAngles(genome.petals, genome.seed + index);
      const ordered = [...angles].sort(
        (a, b) => Math.cos((b * Math.PI) / 180) - Math.cos((a * Math.PI) / 180),
      );
      const petal = cupPetal(R, !poppy);
      return (
        <g
          transform={`${at} rotate(${round1(head.tilt)}) scale(1 ${round1(head.foreshorten)})`}
        >
          {ordered.map((a, i) => (
            <g
              key={i}
              transform={`rotate(${a}) scale(${round1(Math.cos((a * Math.PI) / 180) > 0.2 ? 1.06 : 0.96)})`}
            >
              <path d={petal} fill={`url(#${id}-petal)`} fillOpacity=".94" />
              <path
                d={petal}
                fill="none"
                stroke={tone(colour, 12, 0, 0.3)}
                strokeWidth=".6"
              />
              {poppy && (
                <ellipse
                  cx="0"
                  cy={-R * 0.12}
                  rx={R * 0.2}
                  ry={R * 0.14}
                  fill={tone([250, 30, 12], 0, 0, 0.85)}
                />
              )}
              {Math.cos((a * Math.PI) / 180) > 0.2 && (
                <path d={petal} fill="rgba(40,10,10,.08)" />
              )}
            </g>
          ))}
          {poppy ? (
            <>
              <circle r={R * 0.3} fill={tone([250, 26, 16])} opacity=".9" />
              <circle r={R * 0.17} fill={tone([92, 22, 44])} />
              {Array.from({ length: 8 }, (_, i) => (
                <path
                  key={i}
                  d={`M0,0L${round1(Math.cos((i / 8) * Math.PI * 2) * R * 0.16)},${round1(Math.sin((i / 8) * Math.PI * 2) * R * 0.16)}`}
                  stroke={tone([260, 30, 22])}
                  strokeWidth=".9"
                />
              ))}
            </>
          ) : (
            <>
              <circle
                r={R * 0.3}
                fill={tone(species.centre, 4)}
                opacity=".95"
              />
              {Array.from({ length: 22 }, (_, i) => {
                const a = (i / 22) * Math.PI * 2;
                return (
                  <circle
                    key={i}
                    cx={round1(Math.cos(a) * R * 0.24)}
                    cy={round1(Math.sin(a) * R * 0.24)}
                    r=".9"
                    fill={tone(species.centre, -20)}
                  />
                );
              })}
              <circle r={R * 0.11} fill={tone([80, 40, 58])} />
            </>
          )}
        </g>
      );
    }
    case "fringed": {
      const angles = Array.from(
        { length: genome.petals },
        (_, i) =>
          -100 + (200 * i) / (genome.petals - 1) + (random() - 0.5) * 10,
      );
      const floret = fringedFloret(R);
      return (
        <g transform={`${at} rotate(${round1(head.tilt * 0.6)})`}>
          <ellipse
            cx="0"
            cy={R * 0.28}
            rx={R * 0.38}
            ry={R * 0.46}
            fill={tone(species.stem, -4, -6)}
          />
          {detail &&
            Array.from({ length: 4 }, (_, i) => (
              <path
                key={i}
                d={`M${round1(-R * 0.32)},${round1(R * (0.1 + i * 0.16))}Q0,${round1(R * (0.18 + i * 0.16))} ${round1(R * 0.32)},${round1(R * (0.1 + i * 0.16))}`}
                fill="none"
                stroke={tone(species.stem, -18, 0, 0.6)}
                strokeWidth=".6"
              />
            ))}
          {angles.map((a, i) => (
            <path
              key={`b${i}`}
              d={floret}
              transform={`rotate(${round1(a * 0.7)}) scale(.82)`}
              fill={tone(colour, -14)}
            />
          ))}
          {angles.map((a, i) => (
            <path
              key={i}
              d={floret}
              transform={`rotate(${round1(a)})`}
              fill={`url(#${id}-petal)`}
            />
          ))}
          <circle cy={-R * 0.05} r={R * 0.2} fill={tone(species.centre, 0)} />
        </g>
      );
    }
    case "globe": {
      const cy = -R * 0.85;
      return (
        <g transform={`${at} rotate(${round1(head.tilt * 0.4)})`}>
          <ellipse
            cx="0"
            cy={cy}
            rx={R}
            ry={R * 1.12}
            fill={`url(#${id}-petal)`}
          />
          {Array.from({ length: detail ? 40 : 18 }, (_, i) => {
            const a = random() * Math.PI * 2;
            const d = Math.sqrt(random()) * 0.85;
            const x = Math.cos(a) * R * d;
            const y = cy + Math.sin(a) * R * 1.1 * d;
            const len = R * 0.34;
            const ox = Math.cos(a) * len * 0.6;
            const oy = Math.sin(a) * len * 0.6 - len * 0.5;
            return (
              <path
                key={i}
                d={`M${round1(x)},${round1(y)}l${round1(ox)},${round1(oy)}`}
                stroke={tone(colour, (random() - 0.5) * 18)}
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            );
          })}
          <path
            d={sepalPath(R * 0.7)}
            transform={`translate(0 ${round1(R * 0.1)})`}
            fill={tone(species.stem, -8)}
          />
        </g>
      );
    }
    case "umbel": {
      const rays = 9;
      return (
        <g transform={`${at} rotate(${round1(head.tilt * 0.3)})`}>
          {Array.from({ length: rays }, (_, i) => {
            const x = -R + (2 * R * i) / (rays - 1) + (random() - 0.5) * 3;
            const y = -R * 0.5 - (1 - (x / R) ** 2) * R * 0.28;
            return (
              <g key={i}>
                <path
                  d={`M0,0Q${round1(x * 0.4)},${round1(y * 0.7)} ${round1(x)},${round1(y)}`}
                  fill="none"
                  stroke={tone(species.stem, 4)}
                  strokeWidth=".9"
                />
                {Array.from({ length: 6 }, (_, j) => {
                  const fx = x + (random() - 0.5) * 7;
                  const fy = y - random() * 4;
                  return (
                    <g key={j}>
                      <circle
                        cx={round1(fx)}
                        cy={round1(fy)}
                        r="2.4"
                        fill={tone(colour, (random() - 0.5) * 6)}
                      />
                      <circle
                        cx={round1(fx)}
                        cy={round1(fy)}
                        r=".7"
                        fill={tone(species.centre, -18)}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      );
    }
    case "spike": {
      const foxglove = species.id === "foxglove";
      const spine = head.spine!;
      const side = genome.seed & 1 ? 1 : -1;
      const n = foxglove
        ? Math.max(9, genome.petals)
        : Math.max(16, genome.petals + 4);
      // Draw from the tip down so lower florets overlap the ones above them.
      const points = racemePoints(spine.from, spine.to, n).reverse();
      return (
        <g>
          {points.map(({ at: p, t }, i) => {
            const open = t < (foxglove ? 0.7 : 0.78);
            if (foxglove) {
              const size = R * 1.25 * (1 - t * 0.5);
              if (!open)
                return (
                  <ellipse
                    key={i}
                    cx={p[0] + side * size * 0.25}
                    cy={p[1]}
                    rx={size * 0.24}
                    ry={size * 0.36}
                    fill={t > 0.88 ? `url(#${id}-bud)` : tone(colour, -12, -10)}
                  />
                );
              return (
                <g
                  key={i}
                  transform={`translate(${round1(p[0] + side * size * 0.18)} ${p[1]}) rotate(${round1(side * (34 + random() * 14))})`}
                >
                  <path d={bellFloret(size)} fill={`url(#${id}-bell)`} />
                  <path
                    d={bellFloret(size)}
                    fill="none"
                    stroke={tone(colour, -18, 0, 0.35)}
                    strokeWidth=".5"
                  />
                  <ellipse
                    cx="0"
                    cy={round1(size * 0.88)}
                    rx={round1(size * 0.44)}
                    ry={round1(size * 0.13)}
                    fill={tone(colour, -28, 4)}
                  />
                  <ellipse
                    cx="0"
                    cy={round1(size * 0.86)}
                    rx={round1(size * 0.36)}
                    ry={round1(size * 0.08)}
                    fill={tone(colour, 24, -16)}
                  />
                  {detail &&
                    [0.3, 0.5, 0.7].map((f) => (
                      <circle
                        key={f}
                        cx={round1((f - 0.5) * size * 0.5)}
                        cy={round1(size * 0.84)}
                        r=".8"
                        fill={tone(colour, -38)}
                      />
                    ))}
                </g>
              );
            }
            const size = R * 0.72 * (1 - t * 0.62);
            const spread = size * 0.55;
            if (!open)
              return (
                <ellipse
                  key={i}
                  cx={p[0]}
                  cy={p[1]}
                  rx={size * 0.5}
                  ry={size * 0.42}
                  fill={t > 0.9 ? `url(#${id}-bud)` : tone(colour, -14, -8)}
                />
              );
            return (
              <g key={i} transform={`translate(${p[0]} ${p[1]})`}>
                {[-1, 1].map((k) => (
                  <g
                    key={k}
                    transform={`translate(${round1(k * spread)} ${round1(size * 0.1)}) rotate(${k * 38})`}
                  >
                    <path d={peaFloret(size)} fill={tone(colour, 4 - t * 14)} />
                    <path
                      d={peaFloret(size * 0.62)}
                      transform={`translate(0 ${round1(-size * 0.42)})`}
                      fill={tone(colour, 26 - t * 10, -18)}
                    />
                  </g>
                ))}
                {i % 2 === 0 && (
                  <path
                    d={peaFloret(size * 0.9)}
                    fill={tone(colour, -2 - t * 14)}
                  />
                )}
              </g>
            );
          })}
        </g>
      );
    }
    case "plume":
    default: {
      const spine = head.spine!;
      const [fx, fy] = spine.from;
      const [tx, ty] = spine.to;
      const w = R;
      return (
        <g>
          <path
            d={`M${round1(fx)},${round1(fy)}L${round1(tx)},${round1(ty)}`}
            stroke={tone(colour, -6)}
            strokeWidth={w * 1.1}
            strokeLinecap="round"
          />
          {Array.from({ length: detail ? 30 : 12 }, (_, i) => {
            const t = random();
            const x = fx + (tx - fx) * t + (random() - 0.5) * w;
            const y = fy + (ty - fy) * t;
            return (
              <path
                key={i}
                d={`M${round1(x)},${round1(y)}l${round1((random() - 0.5) * 5)},${round1(-2 - random() * 3)}`}
                stroke={tone(colour, 10 + random() * 10)}
                strokeWidth=".8"
                strokeLinecap="round"
              />
            );
          })}
          {detail &&
            Array.from({ length: 12 }, (_, i) => {
              const t = random();
              return (
                <circle
                  key={`a${i}`}
                  cx={round1(fx + (tx - fx) * t + (random() - 0.5) * w * 1.3)}
                  cy={round1(fy + (ty - fy) * t)}
                  r=".9"
                  fill={tone([290, 30, 50])}
                />
              );
            })}
        </g>
      );
    }
  }
}
