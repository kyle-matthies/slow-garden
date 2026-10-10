"use client";
import {
  AnimatePresence,
  LazyMotion,
  animate,
  domAnimation,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Entry, Garden, Plot, Seed } from "@/lib/garden/types";
import {
  bedWidth,
  fieldOfView,
  isVisible,
  nearestAngle,
  nearestBed,
  pixelsPerDegree,
  wrap,
} from "@/lib/garden/scene/camera";
import { hashString } from "@/lib/garden/scene/hash";
import { buildBeds } from "@/lib/garden/scene/model";
import { paletteFor } from "@/lib/garden/scene/palette";
import { EMPTY_TENDING, type Tending } from "@/lib/garden/scene/tending";
import { PlantFocus } from "./plant-focus";
import { BedSign, SceneBed, type SceneMetrics } from "./scene-bed";
import { useAtmosphere } from "./use-atmosphere";
import "./scene.css";

const subscribeDark = (callback: () => void) => {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const getDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const SPRING = { type: "spring" as const, stiffness: 70, damping: 18, mass: 1 };

export type GardenSceneProps = {
  garden: Garden;
  plots: Plot[];
  seeds: Seed[];
  entries: Entry[];
  tending?: Tending;
  topicId: string;
  focusId: string;
  /** "backdrop" is a still, inert scene behind the writing page. */
  mode?: "interactive" | "backdrop";
  canWrite?: boolean;
  onTopic?: (topicId: string) => void;
  onFocus?: (seedId: string) => void;
  onOpenThought?: (seedId: string) => void;
  onListView?: (topicId: string) => void;
  newTopic?: ReactNode;
  newThought?: (plotId: string) => ReactNode;
};

/**
 * The living garden. The viewer stands in the middle of a circular garden and
 * turns from bed to bed. Plants are thoughts; they grow from the person's own
 * tending. Everything legible sits on paper. The scene stays still while
 * someone writes and whenever reduced motion is requested.
 */
export function GardenScene({
  garden,
  plots,
  seeds,
  entries,
  tending = EMPTY_TENDING,
  topicId,
  focusId,
  mode = "interactive",
  canWrite = true,
  onTopic,
  onFocus,
  onOpenThought,
  onListView,
  newTopic,
  newThought,
}: GardenSceneProps) {
  const interactive = mode === "interactive";
  const root = useRef<HTMLElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const dock = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dockHeight, setDockHeight] = useState(72);
  const night = useSyncExternalStore(subscribeDark, getDark, () => false);
  const reduced = useReducedMotion() ?? false;
  const still = reduced || !interactive;
  const palette = useMemo(() => paletteFor(garden.id, night), [garden.id, night]);
  const beds = useMemo(
    () => buildBeds(plots, seeds, entries, tending),
    [plots, seeds, entries, tending],
  );
  const angles = useMemo(() => beds.map((b) => b.angle), [beds]);
  const topicIndex = beds.findIndex((b) => b.plot.id === topicId);
  const theta = useMotionValue(topicIndex >= 0 ? angles[topicIndex] : 0);
  const zoom = useMotionValue(1);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(element);
    const dockObserver = new ResizeObserver(([entry]) =>
      setDockHeight(Math.round(entry.target.getBoundingClientRect().height)),
    );
    if (dock.current) dockObserver.observe(dock.current);
    return () => {
      observer.disconnect();
      dockObserver.disconnect();
    };
  }, []);

  const metrics = useMemo<SceneMetrics | null>(() => {
    const { width, height } = size;
    if (!width || !height) return null;
    const fov = fieldOfView(width, height);
    const horizonY = height * (height < 620 ? 0.34 : 0.42);
    const groundH = height - horizonY;
    return {
      width,
      height,
      horizonY,
      groundH,
      fov,
      ppd: pixelsPerDegree(width, fov),
      bedWidthDeg: bedWidth(Math.max(1, beds.length), fov),
      plantScale: (groundH * 0.68) / 280,
      signTop: height - (interactive ? dockHeight + 24 : 16) - 118,
      night,
    };
  }, [size, beds.length, night, dockHeight, interactive]);

  useAtmosphere({
    back,
    front,
    windTarget: root,
    palette,
    seed: hashString(`garden:${garden.id}`),
    horizon: metrics ? metrics.horizonY / metrics.height : 0.42,
    fov: metrics?.fov ?? 88,
    still,
    theta,
    width: size.width,
    height: size.height,
  });

  // Turn toward the selected topic, and step closer while it is selected.
  useEffect(() => {
    const target = topicIndex >= 0 ? nearestAngle(theta.get(), angles[topicIndex]) : null;
    if (target !== null) {
      if (reduced) theta.set(target);
      else animate(theta, target, SPRING);
    }
    const nextZoom = topicIndex >= 0 && interactive ? 1.1 : 1;
    if (reduced) zoom.set(nextZoom);
    else animate(zoom, nextZoom, { type: "spring", stiffness: 60, damping: 20 });
  }, [topicIndex, angles, theta, zoom, reduced, interactive]);

  // Which beds to render follows the camera coarsely (every few degrees), so
  // turning does not re-render React on every frame.
  const [coarseTheta, setCoarseTheta] = useState(() => theta.get());
  useMotionValueEvent(theta, "change", (t) => {
    if (Math.abs(t - coarseTheta) > 3) setCoarseTheta(t);
  });
  const visible = useMemo(
    () =>
      metrics
        ? beds
            .map((b, i) =>
              isVisible(b.angle, coarseTheta, metrics.fov, metrics.bedWidthDeg * 0.7 + 4) ? i : -1,
            )
            .filter((i) => i >= 0)
        : [],
    [beds, metrics, coarseTheta],
  );

  const [settled, setSettled] = useState(true);
  useMotionValueEvent(theta, "animationStart", () => setSettled(false));
  useMotionValueEvent(theta, "animationComplete", () => setSettled(true));

  const turnTo = useCallback(
    (index: number) => {
      if (!beds.length) return;
      const i = ((index % beds.length) + beds.length) % beds.length;
      if (topicId && onTopic) {
        onTopic(beds[i].plot.id);
        return;
      }
      const target = nearestAngle(theta.get(), beds[i].angle);
      if (reduced) theta.set(target);
      else animate(theta, target, SPRING);
    },
    [beds, theta, reduced, topicId, onTopic],
  );
  const current = beds.length ? nearestBed(theta.get(), angles) : -1;

  // Drag (or swipe) to turn; release settles on the nearest bed.
  const drag = useRef<{ x: number; theta: number; moved: boolean; t: number; v: number } | null>(null);
  function onPointerDown(event: React.PointerEvent) {
    if (!interactive || !metrics || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, .plant-focus, .scene-panel")) return;
    drag.current = { x: event.clientX, theta: theta.get(), moved: false, t: event.timeStamp, v: 0 };
    theta.stop();
  }
  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current;
    if (!d || !metrics) return;
    const dx = event.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    d.moved = true;
    const next = d.theta - dx / metrics.ppd;
    const dt = Math.max(1, event.timeStamp - d.t);
    d.v = (next - theta.get()) / dt;
    d.t = event.timeStamp;
    theta.set(next);
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved || !beds.length) return;
    const projected = theta.get() + d.v * 260;
    const index = nearestBed(projected, angles);
    if (topicId && onTopic && beds[index].plot.id !== topicId) {
      onTopic(beds[index].plot.id);
      return;
    }
    const target = nearestAngle(theta.get(), angles[index]);
    if (reduced) theta.set(target);
    else animate(theta, target, { ...SPRING, velocity: d.v * 1000 });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!interactive) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      if (focusId) return;
      event.preventDefault();
      const base = topicIndex >= 0 ? topicIndex : nearestBed(theta.get(), angles);
      turnTo(base + (event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === "Escape") {
      if (focusId) {
        event.preventDefault();
        closeFocus();
      } else if (topicId) {
        event.preventDefault();
        onTopic?.("");
      }
    }
  }

  const lastFocus = useRef("");
  useEffect(() => {
    if (focusId) lastFocus.current = focusId;
  }, [focusId]);
  function closeFocus() {
    const id = focusId || lastFocus.current;
    onFocus?.("");
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLElement>(`[data-plant="${CSS.escape(id)}"]`)?.focus(),
    );
  }

  const seedsById = useMemo(() => new Map(seeds.map((s) => [s.id, s])), [seeds]);
  const focusPlant = focusId
    ? beds.flatMap((b) => b.plants).find((p) => p.seed.id === focusId)
    : undefined;
  const focusBed = focusPlant ? beds.find((b) => b.plot.id === focusPlant.seed.plot_id) : undefined;
  const topicBed = topicIndex >= 0 ? beds[topicIndex] : undefined;

  return (
    <LazyMotion features={domAnimation} strict>
      <section
        ref={root}
        className={`garden-scene palette-${palette.name}${interactive ? "" : " is-backdrop"}${focusId ? " has-focus" : ""}`}
        aria-label={interactive ? `${garden.name}, a living garden` : undefined}
        aria-hidden={interactive ? undefined : true}
        inert={!interactive}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={
          {
            "--sky-top": palette.skyTop,
            "--sky-horizon": palette.skyHorizon,
            "--light": palette.light,
            "--light-glow": palette.lightGlow,
            "--horizon": metrics ? `${metrics.horizonY}px` : "42%",
          } as React.CSSProperties
        }
      >
        <div className="scene-sky" aria-hidden="true">
          <SceneLight theta={theta} metrics={metrics} palette={palette} />
          {palette.night && <span className="scene-stars" />}
          <span className="scene-clouds" />
        </div>
        <SceneWorld zoom={zoom} metrics={metrics}>
          <canvas ref={back} className="scene-canvas" aria-hidden="true" />
          {metrics &&
            visible.map((i) => (
              <SceneBed
                key={beds[i].plot.id}
                bed={beds[i]}
                theta={theta}
                metrics={metrics}
                focusId={focusId}
                interactive={interactive}
                showThreads={settled && beds[i].plot.id === topicId}
                tending={tending}
                onPlant={(id) => onFocus?.(id)}
              />
            ))}
          <canvas ref={front} className="scene-canvas scene-canvas-front" aria-hidden="true" />
          {metrics &&
            visible.map((i) => (
              <BedSign
                key={beds[i].plot.id}
                bed={beds[i]}
                theta={theta}
                metrics={metrics}
                current={beds[i].plot.id === topicId}
                interactive={interactive}
                onSelect={(id) => onTopic?.(id === topicId ? "" : id)}
              />
            ))}
        </SceneWorld>
        {interactive && (
          <>
            <div className="scene-title">
              <p className="scene-kicker">{topicBed ? "Topic" : "Garden"}</p>
              <h1>{topicBed ? topicBed.plot.name : garden.name}</h1>
              {topicBed && (
                <p className="scene-subtitle">
                  in {garden.name}
                  {topicBed.resting > 0 && ` · ${topicBed.resting} more resting in the list`}
                </p>
              )}
            </div>
            {beds.length > 1 && (
              <>
                <button
                  type="button"
                  className="scene-turn scene-turn-left"
                  aria-label="Turn left to the previous topic"
                  onClick={() => turnTo((topicIndex >= 0 ? topicIndex : current) - 1)}
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  type="button"
                  className="scene-turn scene-turn-right"
                  aria-label="Turn right to the next topic"
                  onClick={() => turnTo((topicIndex >= 0 ? topicIndex : current) + 1)}
                >
                  <span aria-hidden="true">›</span>
                </button>
              </>
            )}
            <nav ref={dock} className="scene-panel scene-dock" aria-label="Topics in this garden">
              {topicBed ? (
                <div className="dock-topic">
                  <div className="dock-actions">
                    {canWrite && newThought?.(topicBed.plot.id)}
                    <button type="button" className="plain-button" onClick={() => onListView?.(topicBed.plot.id)}>
                      Topic settings &amp; Cabinet
                    </button>
                    <button type="button" className="plain-button" onClick={() => onTopic?.("")}>
                      Whole garden
                    </button>
                  </div>
                  {topicBed.total === 0 && (
                    <p className="dock-hint">Plant a thought to begin this bed.</p>
                  )}
                </div>
              ) : (
                <>
                  {beds.length > 0 && (
                    <ul className="dock-chips">
                      {beds.map((b) => (
                        <li key={b.plot.id}>
                          <button type="button" className="dock-chip" onClick={() => onTopic?.(b.plot.id)}>
                            {b.plot.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {beds.length === 0 && (
                    <p className="dock-hint">
                      Make a first clearing: a topic gathers related thoughts.
                    </p>
                  )}
                  {canWrite && <div className="dock-actions">{newTopic}</div>}
                </>
              )}
              <p className="visually-hidden">
                Use the left and right arrow keys or the topic buttons to turn through this
                garden. The list view shows every thought.
              </p>
            </nav>
            {focusId && <div className="scene-scrim" aria-hidden="true" onClick={closeFocus} />}
            <AnimatePresence>
              {focusPlant && focusBed && (
                <PlantFocus
                  key={focusPlant.seed.id}
                  plant={focusPlant}
                  topicName={focusBed.plot.name}
                  entries={entries.filter((e) => e.seed_id === focusPlant.seed.id)}
                  seedsById={seedsById}
                  night={night}
                  reduced={reduced}
                  canWrite={canWrite}
                  onWrite={() => onOpenThought?.(focusPlant.seed.id)}
                  onClose={closeFocus}
                />
              )}
            </AnimatePresence>
          </>
        )}
      </section>
    </LazyMotion>
  );
}

function SceneWorld({
  zoom,
  metrics,
  children,
}: {
  zoom: ReturnType<typeof useMotionValue<number>>;
  metrics: SceneMetrics | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMotionValueEvent(zoom, "change", (z) => {
    if (ref.current) ref.current.style.transform = `scale(${z.toFixed(4)})`;
  });
  return (
    <div
      ref={ref}
      className="scene-world"
      style={{
        transformOrigin: metrics
          ? `50% ${Math.round(metrics.horizonY + metrics.groundH * 0.55)}px`
          : "50% 70%",
      }}
    >
      {children}
    </div>
  );
}

function SceneLight({
  theta,
  metrics,
  palette,
}: {
  theta: ReturnType<typeof useMotionValue<number>>;
  metrics: SceneMetrics | null;
  palette: ReturnType<typeof paletteFor>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const place = useCallback(
    (t: number) => {
      if (!ref.current || !metrics) return;
      const x = metrics.width / 2 + wrap(palette.lightAngle - t * 0.05) * metrics.ppd;
      const y = metrics.horizonY * (1 - palette.lightHeight) - metrics.horizonY * 0.05;
      ref.current.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    },
    [metrics, palette],
  );
  useEffect(() => place(theta.get()), [place, theta]);
  useMotionValueEvent(theta, "change", place);
  return <span ref={ref} className={`scene-light${palette.night ? " is-moon" : ""}`} />;
}
