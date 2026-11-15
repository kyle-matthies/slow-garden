"use client";
import {
  LazyMotion,
  animate,
  domAnimation,
  m,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Garden } from "@/lib/garden/types";
import { nearestAngle, wrap } from "@/lib/garden/scene/camera";
import { hashString, seededRandom } from "@/lib/garden/scene/hash";
import {
  BED_HUES,
  paletteFor,
  type Palette,
} from "@/lib/garden/scene/palette";
import { mix } from "./atmosphere";
import "./scene.css";

const subscribeDark = (callback: () => void) => {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const getDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const SPRING = { type: "spring" as const, stiffness: 80, damping: 18 };

/** A small painted vista of one garden: its own light, hills, beds and meadow. */
function Vista({ garden, palette }: { garden: Garden; palette: Palette }) {
  const art = useMemo(() => {
    const random = seededRandom(hashString(`vista:${garden.id}`));
    const ridge = (base: number, amp: number, freqs: number[]) => {
      const phases = freqs.map(() => random() * Math.PI * 2);
      const amps = freqs.map((f) => (0.4 + random() * 0.6) / Math.sqrt(f));
      const norm = amps.reduce((a, b) => a + b, 0);
      const at = (x: number) => {
        let y = 0;
        freqs.forEach(
          (f, i) =>
            (y += amps[i] * Math.sin((f * x * Math.PI) / 160 + phases[i])),
        );
        return base - amp * (0.5 + (0.5 * y) / norm);
      };
      let d = `M0,200L0,${base}`;
      for (let x = 0; x <= 320; x += 8) d += `L${x},${at(x).toFixed(1)}`;
      return { d: `${d}L320,200Z`, at };
    };
    const hills = [
      ridge(110, 26, [1, 2, 3]),
      ridge(113, 19, [1, 3, 5]),
      ridge(117, 13, [2, 5, 7]),
      ridge(121, 8, [3, 4, 6]),
    ];
    const trees = Array.from({ length: 16 }, () => {
      const x = random() * 320;
      return { x, y: hills[3].at(x) + 1, r: 1.6 + random() * 2.2 };
    });
    const clouds = Array.from({ length: 3 }, (_, i) => {
      const x = 40 + i * 110 + random() * 50;
      const y = 18 + random() * 44;
      const w = 30 + random() * 34;
      return [
        { x, y, rx: w * 1.3, ry: 2.6 },
        { x: x - w * 0.2, y: y - 2.6, rx: w * 0.8, ry: 3 },
        { x: x + w * 0.3, y: y - 4.4, rx: w * 0.5, ry: 3.2 },
      ];
    });
    // Three small beds across the middle ground, each with its own hue.
    const first = hashString(`vista-hue:${garden.id}`);
    const beds = [-1, 0, 1].map((side, i) => {
      const cx = 160 + side * 104;
      const hue = BED_HUES[(first + i * 3) % BED_HUES.length];
      const flowers = Array.from({ length: 12 }, () => ({
        x: cx + (random() - 0.5) * 62,
        y: 152 - random() * 15,
        r: 0.9 + random() * 1.2,
        l: (random() - 0.5) * 16,
      }));
      const stems = Array.from({ length: 5 }, () => ({
        x: cx + (random() - 0.5) * 48,
        h: 9 + random() * 15,
        lean: (random() - 0.5) * 5,
      }));
      return { cx, hue, flowers, stems, front: side === 0 };
    });
    const specks = Array.from({ length: 22 }, () => ({
      x: random() * 320,
      y: 164 + Math.pow(random(), 0.7) * 34,
      r: 0.7 + random() * 1.5,
      c: palette.specks[Math.floor(random() * palette.specks.length)],
    }));
    return { hills, trees, clouds, beds, specks };
  }, [garden.id, palette]);
  const id = `v${hashString(garden.id).toString(36)}`;
  const sunX = 160 + Math.max(-120, Math.min(120, palette.lightAngle * 2));
  const sunY = 110 - palette.lightHeight * 96;
  const hillTones = [
    mix(palette.far, palette.mist, 0.6),
    mix(palette.far, palette.mist, 0.38),
    mix(palette.treeline, palette.mist, 0.24),
    mix(palette.treeline, palette.mist, 0.06),
  ];
  const tree = mix(palette.treeline, "#0c1410", 0.2);
  return (
    <svg
      className="ring-vista"
      viewBox="0 0 320 200"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={palette.skyZenith} />
          <stop offset=".26" stopColor={palette.skyTop} />
          <stop offset=".52" stopColor={palette.skyHorizon} />
          <stop offset=".62" stopColor={palette.horizonGlow} />
        </linearGradient>
        <linearGradient id={`${id}-ground`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={mix(palette.near, palette.mist, 0.3)} />
          <stop offset=".28" stopColor={palette.groundTop} />
          <stop offset="1" stopColor={palette.groundBottom} />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor={palette.light} />
          <stop offset=".12" stopColor={palette.light} />
          <stop offset=".2" stopColor={palette.lightGlow} />
          <stop offset="1" stopColor={palette.lightGlow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-mist`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={palette.mist} stopOpacity="0" />
          <stop offset=".5" stopColor={palette.mist} stopOpacity=".55" />
          <stop offset="1" stopColor={palette.mist} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-soil`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={palette.soil[0]} />
          <stop offset="1" stopColor={palette.soil[1]} />
        </linearGradient>
      </defs>
      <rect width="320" height="200" fill={`url(#${id}-sky)`} />
      <circle
        cx={sunX}
        cy={sunY}
        r={palette.night ? 40 : 70}
        fill={`url(#${id}-sun)`}
      />
      <g className="ring-vista-clouds" opacity={palette.night ? 0.35 : 0.8}>
        {art.clouds.map((cloud, i) => (
          <g key={i}>
            {cloud.map((c, j) => (
              <ellipse
                key={j}
                cx={c.x.toFixed(1)}
                cy={c.y.toFixed(1)}
                rx={c.rx.toFixed(1)}
                ry={c.ry}
                fill={j === 0 ? palette.cloudShade : palette.cloud}
                opacity={j === 0 ? 0.5 : 0.7}
              />
            ))}
          </g>
        ))}
      </g>
      {art.hills.map((hill, i) => (
        <path key={i} d={hill.d} fill={hillTones[i]} />
      ))}
      {art.trees.map((t, i) => (
        <circle
          key={i}
          cx={t.x.toFixed(1)}
          cy={(t.y - t.r * 0.6).toFixed(1)}
          r={t.r.toFixed(1)}
          fill={tree}
        />
      ))}
      <rect y="122" width="320" height="78" fill={`url(#${id}-ground)`} />
      <rect y="108" width="320" height="30" fill={`url(#${id}-mist)`} />
      <path
        d="M150 157C154 170 142 184 120 200L200 200C178 184 166 170 170 157Z"
        fill={palette.light}
        opacity=".16"
      />
      {art.beds.map((bed, i) => (
        <g key={i} opacity={bed.front ? 1 : 0.72}>
          <ellipse
            cx={bed.cx}
            cy="150"
            rx="40"
            ry="7"
            fill={mix(palette.stone[0], palette.stone[1], 0.4)}
          />
          <ellipse cx={bed.cx} cy="149.5" rx="37.5" ry="5.6" fill={`url(#${id}-soil)`} />
          {bed.stems.map((s, j) => (
            <path
              key={j}
              d={`M${s.x.toFixed(1)},151q${(s.lean / 2).toFixed(1)},${(-s.h / 2).toFixed(1)} ${s.lean.toFixed(1)},${(-s.h).toFixed(1)}`}
              stroke={palette.grass[4]}
              strokeWidth="0.9"
              fill="none"
            />
          ))}
          {bed.stems.map((s, j) => (
            <circle
              key={j}
              cx={(s.x + s.lean).toFixed(1)}
              cy={(151 - s.h).toFixed(1)}
              r="1.9"
              fill={`hsl(${bed.hue[0]} ${palette.night ? bed.hue[1] * 0.5 : bed.hue[1]}% ${(palette.night ? 0.6 : 1) * (bed.hue[2] + 6)}%)`}
            />
          ))}
          {bed.flowers.map((f, j) => (
            <circle
              key={j}
              cx={f.x.toFixed(1)}
              cy={f.y.toFixed(1)}
              r={f.r.toFixed(1)}
              fill={`hsl(${bed.hue[0]} ${palette.night ? bed.hue[1] * 0.5 : bed.hue[1]}% ${(palette.night ? 0.6 : 1) * (bed.hue[2] + f.l)}%)`}
            />
          ))}
        </g>
      ))}
      <path
        d="M0 200L0 176Q40 168 80 178T160 176T240 180T320 172L320 200Z"
        fill={palette.grass[5]}
        opacity=".55"
      />
      {art.specks.map((s, i) => (
        <circle
          key={i}
          cx={s.x.toFixed(1)}
          cy={s.y.toFixed(1)}
          r={s.r.toFixed(1)}
          fill={s.c}
          opacity=".9"
        />
      ))}
    </svg>
  );
}

function RingCard({
  index,
  step,
  theta,
  spread,
  selected,
  children,
}: {
  index: number;
  step: number;
  theta: MotionValue<number>;
  /** Horizontal distance between the front card and its first neighbour. */
  spread: number;
  selected: boolean;
  children: ReactNode;
}) {
  // Offset from the front, in cards: 0 is the garden you would enter.
  const k = useTransform(theta, (t) => wrap(index * step - t) / step);
  const x = useTransform(k, (v) => {
    const a = Math.abs(v);
    return Math.sign(v) * (a <= 1 ? a * spread : spread + (a - 1) * spread * 0.55);
  });
  const scale = useTransform(k, (v) => 1 - Math.min(Math.abs(v), 3) * 0.15);
  const rotateY = useTransform(k, (v) => -Math.max(-1, Math.min(1, v)) * 26);
  const opacity = useTransform(k, (v) =>
    Math.max(0, Math.min(1, 1 - (Math.abs(v) - 1.6) * 0.9)),
  );
  const zIndex = useTransform(k, (v) => 200 - Math.round(Math.abs(v) * 10));
  const visibility = useTransform(k, (v) => (Math.abs(v) > 2.7 ? "hidden" : "visible"));
  return (
    <m.li
      className={`ring-card${selected ? " is-selected" : ""}`}
      style={{ x, scale, opacity, zIndex, rotateY, visibility, transformPerspective: 1200 }}
    >
      {children}
    </m.li>
  );
}

/**
 * Every garden on one ring. The garden in front is the one you'd enter; its
 * neighbours recede. Turn with the arrows, a drag, or the keyboard.
 */
export function GardenRing({
  gardens,
  currentId,
  onEnter,
  onClose,
  newGarden,
}: {
  gardens: Garden[];
  currentId: string;
  onEnter: (id: string) => void;
  onClose: () => void;
  newGarden?: ReactNode;
}) {
  const night = useSyncExternalStore(subscribeDark, getDark, () => false);
  const reduced = useReducedMotion() ?? false;
  const count = gardens.length + (newGarden ? 1 : 0);
  const step = Math.min(34, 360 / Math.max(count, 1));
  const start = Math.max(
    0,
    gardens.findIndex((g) => g.id === currentId),
  );
  const theta = useMotionValue(start * step);
  const [selected, setSelected] = useState(start);
  const [leaving, setLeaving] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const cardWidth = Math.min(416, width * (width < 640 ? 0.76 : 0.62));
  const spread = Math.min(cardWidth * 0.86, width * 0.42);

  function select(index: number, focus = false) {
    const i = ((index % count) + count) % count;
    setSelected(i);
    const target = nearestAngle(theta.get(), i * step);
    if (reduced) theta.set(target);
    else animate(theta, target, SPRING);
    if (focus)
      requestAnimationFrame(() =>
        root.current
          ?.querySelector<HTMLElement>(`[data-ring-index="${i}"]`)
          ?.focus({ preventScroll: true }),
      );
  }
  function enter(id: string) {
    if (reduced) return onEnter(id);
    setLeaving(id);
    window.setTimeout(() => onEnter(id), 420);
  }

  const drag = useRef<{ x: number; theta: number; moved: boolean } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const current = gardens[selected];
  const palette = paletteFor(current?.id ?? currentId, night);

  return (
    <LazyMotion features={domAnimation} strict>
      <section
        ref={root}
        className={`garden-ring${leaving ? " is-leaving" : ""}`}
        aria-label="All your gardens"
        style={
          {
            "--sky-zenith": palette.skyZenith,
            "--horizon-glow": palette.horizonGlow,
            "--mist": palette.mist,
            "--light-glow": palette.lightGlow,
            "--sky-top": palette.skyTop,
            "--sky-horizon": palette.skyHorizon,
            "--ground-top": palette.groundTop,
            "--ground-bottom": palette.groundBottom,
            "--far": palette.far,
          } as React.CSSProperties
        }
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest("input, textarea, select"))
            return;
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            select(selected + (e.key === "ArrowRight" ? 1 : -1), true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        onPointerDown={(e) => {
          if (
            (e.target as HTMLElement).closest("input, textarea, select, form")
          )
            return;
          suppressClick.current = false;
          drag.current = { x: e.clientX, theta: theta.get(), moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) < 6) return;
          d.moved = true;
          theta.set(d.theta - (dx / spread) * step);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved) {
            suppressClick.current = true;
            select(Math.round(theta.get() / step));
          }
        }}
        onClickCapture={(e) => {
          // A drag that turned the ring should not also open a garden.
          if (suppressClick.current) {
            suppressClick.current = false;
            e.stopPropagation();
          }
        }}
      >
        <div className="ring-title">
          <p className="scene-kicker">Your gardens</p>
          <h1>{current ? current.name : "A new garden"}</h1>
          <p className="scene-subtitle">
            {gardens.length} {gardens.length === 1 ? "garden" : "gardens"} ·
            turn to choose, then enter
          </p>
        </div>
        <ol className="ring-track">
          {gardens.map((g, i) => (
            <RingCard
              key={g.id}
              index={i}
              step={step}
              theta={theta}
              spread={spread}
              selected={i === selected}
            >
              <button
                type="button"
                className="ring-garden"
                data-ring-index={i}
                aria-label={`${g.name}${g.id === currentId ? ", the garden you were in" : ""}${g.status === "archived" ? ", archived" : ""}. ${i === selected ? "Enter" : "Bring forward"}`}
                aria-current={g.id === currentId ? "true" : undefined}
                onClick={() => (i === selected ? enter(g.id) : select(i))}
              >
                <span className="ring-plate">
                  <Vista garden={g} palette={paletteFor(g.id, night)} />
                </span>
                <span className="ring-label">
                  <span className="ring-name">{g.name}</span>
                  {g.status === "archived" && (
                    <span className="ring-meta">Archived</span>
                  )}
                  {g.id === currentId && (
                    <span className="ring-meta">You were here</span>
                  )}
                </span>
                {leaving === g.id && (
                  <span className="ring-flight" aria-hidden="true" />
                )}
              </button>
            </RingCard>
          ))}
          {newGarden && (
            <RingCard
              index={gardens.length}
              step={step}
              theta={theta}
              spread={spread}
              selected={selected === gardens.length}
            >
              <div
                className="ring-garden ring-new"
                data-ring-index={gardens.length}
                tabIndex={-1}
              >
                <span className="ring-new-mark" aria-hidden="true">
                  ＋
                </span>
                <p className="ring-new-copy">
                  Plant a new garden: a separate space with its own light.
                </p>
                {selected === gardens.length ? (
                  newGarden
                ) : (
                  <button
                    type="button"
                    className="plain-button"
                    onClick={() => select(gardens.length)}
                  >
                    Bring forward
                  </button>
                )}
              </div>
            </RingCard>
          )}
        </ol>
        {count > 1 && (
          <>
            <button
              type="button"
              className="scene-turn scene-turn-left"
              aria-label="Previous garden"
              onClick={() => select(selected - 1, true)}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className="scene-turn scene-turn-right"
              aria-label="Next garden"
              onClick={() => select(selected + 1, true)}
            >
              <span aria-hidden="true">›</span>
            </button>
          </>
        )}
        <div className="scene-panel scene-dock ring-dock">
          {current && (
            <button
              type="button"
              className="primary-button"
              onClick={() => enter(current.id)}
            >
              Enter {current.name}
            </button>
          )}
          <button type="button" className="plain-button" onClick={onClose}>
            Back to this garden
          </button>
        </div>
      </section>
    </LazyMotion>
  );
}
