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
  bedOpacity,
  fieldOfView,
  nearestAngle,
  nearestBed,
  sceneFrame,
  wrap,
} from "@/lib/garden/scene/camera";
import { hashString, lerp, seededRandom } from "@/lib/garden/scene/hash";
import {
  MAX_PLANTS_PER_BED,
  PHONE_PLANTS_PER_BED,
  buildBeds,
} from "@/lib/garden/scene/model";
import { bedHues, paletteFor, type Palette } from "@/lib/garden/scene/palette";
import { EMPTY_TENDING, type Tending } from "@/lib/garden/scene/tending";
import { PlantFocus } from "./plant-focus";
import { BedSign, SceneBed, type SceneMetrics } from "./scene-bed";
import { moteField } from "@/lib/garden/scene/motes";
import { useAtmosphere } from "./use-atmosphere";
import { useSceneAwake } from "./use-scene-awake";
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
  onViewBlooms?: (ids: string[]) => void;
  onRespondMark?: (
    markId: string,
    response: "keep" | "prune",
  ) => Promise<string | null>;
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
  onRespondMark,
  onViewBlooms,
}: GardenSceneProps) {
  const interactive = mode === "interactive";
  const root = useRef<HTMLElement>(null);
  const far = useRef<HTMLCanvasElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const dock = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dockHeight, setDockHeight] = useState(72);
  const night = useSyncExternalStore(subscribeDark, getDark, () => false);
  const reduced = useReducedMotion() ?? false;
  // Nothing moves behind the writing page or when reduced motion is asked for.
  const still = reduced || !interactive;
  useSceneAwake(root);
  const palette = useMemo(
    () => paletteFor(garden.id, night),
    [garden.id, night],
  );
  // Phones show fewer plants per bed (ADR-007 budget); the sign says how many
  // more wait in Pages.
  const narrow = size.width > 0 && size.width <= 480;
  const beds = useMemo(
    () =>
      buildBeds(
        plots,
        seeds,
        entries,
        tending,
        narrow ? PHONE_PLANTS_PER_BED : MAX_PLANTS_PER_BED,
        focusId,
      ),
    [plots, seeds, entries, tending, narrow, focusId],
  );
  const angles = useMemo(() => beds.map((b) => b.angle), [beds]);
  const hues = useMemo(() => bedHues(plots.map((p) => p.id)), [plots]);
  const topicIndex = beds.findIndex((b) => b.plot.id === topicId);
  const theta = useMotionValue(topicIndex >= 0 ? angles[topicIndex] : 0);
  const zoom = useMotionValue(1);
  // The zoom the beds are laid out for. While the camera steps closer or
  // back the laid-out beds are scaled; once it settles they are laid out
  // afresh at the new size, so plants and soil stay crisp.
  const [layoutZoom, setLayoutZoom] = useState(1);

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

  const frame = useMemo(
    () => (size.width ? sceneFrame(size.width, beds.length) : null),
    [size.width, beds.length],
  );
  const metrics = useMemo<SceneMetrics | null>(() => {
    const { width, height } = size;
    if (!width || !height || !frame) return null;
    const fov = fieldOfView(width, height);
    const horizonY = height * (height < 620 ? 0.34 : width <= 640 ? 0.36 : 0.4);
    const groundH = height - horizonY;
    // At a topic the bed's front edge stands just above the dock and its sign.
    const phone = width <= 640;
    // Room below it for the stones, the sign on its stake, and the dock.
    const front = Math.max(
      horizonY + groundH * 0.3,
      height - (phone ? 206 : 194),
    );
    const z = frame.topicZoom;
    const yFront = horizonY + (front - horizonY) / z;
    const yBack = horizonY + (yFront - horizonY) * (phone ? 0.46 : 0.55);
    // A tall flowering plant in the front row is a little under half the
    // scene's height at a topic, and never wider than its bed allows.
    const plantScale =
      Math.min(height * 0.56, frame.bedWidth * z * 0.86) / 280 / z;
    const lz = layoutZoom;
    return {
      width,
      height,
      horizonY,
      groundH,
      fov,
      ppd: frame.ppd * lz,
      bedWidthDeg: frame.bedWidth / frame.ppd,
      plantScale: plantScale * lz,
      signTop: height - (interactive ? dockHeight + 10 : 16),
      night,
      bedWidth: frame.bedWidth * lz,
      spacing: frame.spacing,
      yBack: horizonY + (yBack - horizonY) * lz,
      yFront: horizonY + (yFront - horizonY) * lz,
      layoutZoom: lz,
    };
  }, [size, frame, night, dockHeight, interactive, layoutZoom]);

  const [settled, setSettled] = useState(true);
  useMotionValueEvent(theta, "animationStart", () => setSettled(false));
  useMotionValueEvent(theta, "animationComplete", () => setSettled(true));
  useMotionValueEvent(theta, "animationCancel", () => setSettled(true));
  // While the camera turns, plants hold their sway (see .is-turning in
  // scene.css).
  const [dragging, setDragging] = useState(false);
  const [stepping, setStepping] = useState(false);
  const turning = dragging || !settled || stepping;

  useAtmosphere({
    far,
    back,
    front,
    palette,
    seed: hashString(`garden:${garden.id}`),
    horizon: metrics ? metrics.horizonY / metrics.height : 0.42,
    fov: metrics?.fov ?? 88,
    theta,
    width: size.width,
    height: size.height,
    zoom,
    // Grass and beds travel together when the camera turns.
    thetaScale:
      frame && metrics ? frame.ppd / (metrics.width / metrics.fov) : 1,
  });

  // Turn toward the selected topic.
  useEffect(() => {
    const target =
      topicIndex >= 0 ? nearestAngle(theta.get(), angles[topicIndex]) : null;
    if (target === null) return;
    if (reduced) theta.set(target);
    else animate(theta, target, SPRING);
  }, [topicIndex, angles, theta, reduced]);

  // Step closer while a topic is selected, and back for the whole garden.
  const topicZoom = frame?.topicZoom ?? 0;
  const placed = useRef(false);
  useEffect(() => {
    if (!topicZoom) return;
    const next = topicIndex >= 0 && interactive ? topicZoom : 1;
    if (reduced || !placed.current) {
      placed.current = true;
      zoom.set(next);
      return;
    }
    if (Math.abs(zoom.get() - next) < 0.001) return;
    const controls = animate(zoom, next, {
      type: "spring",
      stiffness: 60,
      damping: 20,
    });
    return () => controls.stop();
  }, [topicIndex, topicZoom, zoom, reduced, interactive]);
  // Lay the beds out afresh once the camera has arrived (or was simply set).
  useMotionValueEvent(zoom, "change", (z) => {
    if (!zoom.isAnimating()) setLayoutZoom(z);
  });
  useMotionValueEvent(zoom, "animationStart", () => setStepping(true));
  useMotionValueEvent(zoom, "animationComplete", () => {
    setLayoutZoom(zoom.get());
    setStepping(false);
  });
  useMotionValueEvent(zoom, "animationCancel", () => setStepping(false));

  // Which beds to render follows the camera, but React re-renders only when a
  // bed enters or leaves the view, not as the camera turns.
  const visibleAt = useCallback(
    (t: number) =>
      metrics
        ? beds.flatMap((b, i) =>
            bedOpacity(wrap(b.angle - t), metrics.spacing) > 0 ? [i] : [],
          )
        : [],
    [beds, metrics],
  );
  const [coarseTheta, setCoarseTheta] = useState(() => theta.get());
  const visible = useMemo(
    () => visibleAt(coarseTheta),
    [visibleAt, coarseTheta],
  );
  useMotionValueEvent(theta, "change", (t) => {
    const next = visibleAt(t);
    if (next.length !== visible.length || next.some((i, k) => i !== visible[k]))
      setCoarseTheta(t);
  });
  // Stable handlers keep memoised beds from re-rendering with the camera.
  const onPlant = useCallback((id: string) => onFocus?.(id), [onFocus]);
  const onSign = useCallback(
    (id: string) => onTopic?.(id === topicId ? "" : id),
    [onTopic, topicId],
  );


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
  const drag = useRef<{
    x: number;
    theta: number;
    moved: boolean;
    t: number;
    v: number;
  } | null>(null);
  // A drag that ends on a plant or sign must not also open it.
  const dragged = useRef(false);
  function onPointerDown(event: React.PointerEvent) {
    // Any new press starts clean, so a stale drag never swallows a real click.
    dragged.current = false;
    if (!interactive || !metrics || event.button !== 0) return;
    const target = event.target as HTMLElement;
    // Plants and signs cover much of a dense meadow, so a swipe may start on
    // one; other controls and panels keep their own gestures.
    if (
      !target.closest(".scene-plant, .bed-sign") &&
      target.closest(
        "button, a, input, textarea, select, .plant-focus, .scene-panel",
      )
    )
      return;
    drag.current = {
      x: event.clientX,
      theta: theta.get(),
      moved: false,
      t: event.timeStamp,
      v: 0,
    };
    theta.stop();
  }
  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current;
    if (!d || !metrics) return;
    const dx = event.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved)
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (!d.moved) setDragging(true);
    d.moved = true;
    dragged.current = true;
    const next = d.theta - dx / metrics.ppd;
    const dt = Math.max(1, event.timeStamp - d.t);
    d.v = (next - theta.get()) / dt;
    d.t = event.timeStamp;
    theta.set(next);
  }
  function onClickCapture(event: React.MouseEvent) {
    if (!dragged.current) return;
    dragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) setDragging(false);
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
    dragged.current = false;
    if (!interactive) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']"))
      return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      if (focusId) return;
      event.preventDefault();
      const base =
        topicIndex >= 0 ? topicIndex : nearestBed(theta.get(), angles);
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
      root.current
        ?.querySelector<HTMLElement>(`[data-plant="${CSS.escape(id)}"]`)
        ?.focus(),
    );
  }

  const seedsById = useMemo(
    () => new Map(seeds.map((s) => [s.id, s])),
    [seeds],
  );
  const focusPlant = focusId
    ? beds.flatMap((b) => b.plants).find((p) => p.seed.id === focusId)
    : undefined;
  const focusBed = focusPlant
    ? beds.find((b) => b.plot.id === focusPlant.seed.plot_id)
    : undefined;
  const topicBed = topicIndex >= 0 ? beds[topicIndex] : undefined;

  return (
    <LazyMotion features={domAnimation} strict>
      <section
        ref={root}
        className={`garden-scene palette-${palette.name}${interactive ? "" : " is-backdrop"}${still ? " is-still" : ""}${focusId ? " has-focus" : ""}${turning ? " is-turning" : ""}`}
        aria-label={interactive ? `${garden.name}, a living garden` : undefined}
        aria-hidden={interactive ? undefined : true}
        inert={!interactive}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
        // Focus moving to something off to one side must never scroll the
        // picture: the camera turns instead.
        onScroll={(event) => {
          if (event.target !== event.currentTarget) return;
          event.currentTarget.scrollLeft = 0;
          event.currentTarget.scrollTop = 0;
        }}
        style={
          {
            "--sky-top": palette.skyTop,
            "--sky-horizon": palette.skyHorizon,
            "--sky-zenith": palette.skyZenith,
            "--horizon-glow": palette.horizonGlow,
            "--mist": palette.mist,
            "--light": palette.light,
            "--light-glow": palette.lightGlow,
            "--bed-top": metrics ? `${metrics.yBack}px` : "50%",
            "--bed-bottom": metrics ? `${metrics.yFront}px` : "80%",
            "--bed-width": metrics ? `${metrics.bedWidth}px` : "50%",
            "--horizon": metrics ? `${metrics.horizonY}px` : "42%",
          } as React.CSSProperties
        }
      >
        <div className="scene-sky" aria-hidden="true">
          <SceneLight theta={theta} metrics={metrics} palette={palette} />
          {palette.night && <span className="scene-stars" />}
          <SceneClouds palette={palette} seed={garden.id} />
        </div>
        <div className="scene-world">
          <canvas ref={far} className="scene-canvas" aria-hidden="true" />
          <span className="scene-haze" aria-hidden="true" />
          <SceneLight theta={theta} metrics={metrics} palette={palette} wash />
          <canvas ref={back} className="scene-canvas" aria-hidden="true" />
          <span className="scene-pool" aria-hidden="true" />
          <svg
            className={`scene-path${topicBed ? " is-near" : ""}`}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <filter id="scene-path-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.2 1.4" />
              </filter>
              <linearGradient id="scene-path-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={palette.light} stopOpacity=".34" />
                <stop offset="1" stopColor={palette.light} stopOpacity=".1" />
              </linearGradient>
            </defs>
            <path
              d="M43 4C47 2 53 2 57 4C60 40 72 70 92 100L8 100C28 70 40 40 43 4Z"
              fill="url(#scene-path-fill)"
              filter="url(#scene-path-soft)"
            />
          </svg>
          {metrics &&
            visible.map((i) => (
              <SceneBed
                key={beds[i].plot.id}
                bed={beds[i]}
                theta={theta}
                zoom={zoom}
                metrics={metrics}
                palette={palette}
                hue={hues.get(beds[i].plot.id)!}
                focusId={focusId}
                interactive={interactive}
                showThreads
                tending={tending}
                onPlant={onPlant}
              />
            ))}
          <canvas
            ref={front}
            className="scene-canvas scene-canvas-front"
            aria-hidden="true"
          />
          <SceneMotes
            seed={hashString(`garden:${garden.id}`)}
            count={narrow ? 18 : 36}
            palette={palette}
          />
          {metrics &&
            visible.map((i) => (
              <BedSign
                key={beds[i].plot.id}
                bed={beds[i]}
                theta={theta}
                zoom={zoom}
                metrics={metrics}
                hue={hues.get(beds[i].plot.id)!}
                current={beds[i].plot.id === topicId}
                interactive={interactive}
                onSelect={onSign}
                onMore={onListView}
              />
            ))}
        </div>
        <span className="scene-vignette" aria-hidden="true" />
        {interactive && (
          <>
            <div className="scene-title">
              <p className="scene-kicker">{topicBed ? "Topic" : "Garden"}</p>
              <h1>{topicBed ? topicBed.plot.name : garden.name}</h1>
              {topicBed && (
                <p className="scene-subtitle">
                  in {garden.name}
                  {topicBed.resting > 0 &&
                    ` · ${topicBed.resting} more resting in Pages`}
                </p>
              )}
            </div>
            {beds.length > 1 && (
              <>
                <button
                  type="button"
                  className="scene-turn scene-turn-left"
                  aria-label="Turn left to the previous topic"
                  onClick={() =>
                    turnTo((topicIndex >= 0 ? topicIndex : current) - 1)
                  }
                >
                  <span aria-hidden="true">‹</span>
                </button>
                <button
                  type="button"
                  className="scene-turn scene-turn-right"
                  aria-label="Turn right to the next topic"
                  onClick={() =>
                    turnTo((topicIndex >= 0 ? topicIndex : current) + 1)
                  }
                >
                  <span aria-hidden="true">›</span>
                </button>
              </>
            )}
            <nav
              ref={dock}
              className="scene-panel scene-dock"
              aria-label="Topics in this garden"
            >
              {topicBed ? (
                <div className="dock-topic">
                  <div className="dock-actions">
                    {canWrite && newThought?.(topicBed.plot.id)}
                    <button
                      type="button"
                      className="plain-button"
                      onClick={() => onListView?.(topicBed.plot.id)}
                    >
                      Topic settings
                    </button>
                    <button
                      type="button"
                      className="plain-button"
                      onClick={() => onTopic?.("")}
                    >
                      Whole garden
                    </button>
                  </div>
                  {topicBed.total === 0 && (
                    <p className="dock-hint">
                      Plant a thought to begin this bed.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {beds.length > 0 && (
                    <ul className="dock-chips">
                      {beds.map((b) => (
                        <li key={b.plot.id}>
                          <button
                            type="button"
                            className="dock-chip"
                            onClick={() => onTopic?.(b.plot.id)}
                          >
                            <span
                              className="dock-chip-hue"
                              aria-hidden="true"
                              style={{
                                background: hueCss(
                                  hues.get(b.plot.id)!,
                                  night,
                                ),
                              }}
                            />
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
                Use the left and right arrow keys or the topic buttons to turn
                through this garden. Pages shows every thought.
              </p>
            </nav>
            {focusId && (
              <div
                className="scene-scrim"
                aria-hidden="true"
                onClick={closeFocus}
              />
            )}
            <AnimatePresence>
              {focusPlant && focusBed && (
                <PlantFocus
                  key={focusPlant.seed.id}
                  plant={focusPlant}
                  topicName={focusBed.plot.name}
                  entries={entries.filter(
                    (e) => e.seed_id === focusPlant.seed.id,
                  )}
                  seedsById={seedsById}
                  night={night}
                  reduced={reduced}
                  canWrite={canWrite}
                  onWrite={() => onOpenThought?.(focusPlant.seed.id)}
                  onClose={closeFocus}
                  onRespondMark={onRespondMark}
                  onViewBlooms={onViewBlooms}
                  onReviewBlooms={
                    onListView ? () => onListView(focusBed.plot.id) : undefined
                  }
                />
              )}
            </AnimatePresence>
          </>
        )}
      </section>
    </LazyMotion>
  );
}

function hueCss(
  [h, sat, l]: readonly [number, number, number],
  night: boolean,
) {
  return `hsl(${h} ${night ? sat * 0.6 : sat}% ${night ? l * 0.7 : l}%)`;
}

/**
 * Pollen by day, fireflies at night, drifting in front of the plants. Each is
 * a dot moved and faded by CSS alone (scene.css): decoration, not content.
 */
function SceneMotes({
  seed,
  count,
  palette,
}: {
  seed: number;
  count: number;
  palette: Palette;
}) {
  const motes = useMemo(
    () => moteField(seed, count, palette.night),
    [seed, count, palette.night],
  );
  return (
    <div
      className="scene-motes"
      aria-hidden="true"
      style={{ "--particle": palette.particle } as React.CSSProperties}
    >
      {motes.map((m, i) => (
        <span
          key={i}
          className="scene-mote"
          style={
            {
              left: `${m.x}%`,
              top: `${m.y}%`,
              width: m.size,
              height: m.size,
              "--dx": `${m.dx}px`,
              "--dy": `${m.dy}px`,
              "--drift": `${m.driftSeconds}s`,
              "--twinkle": `${m.twinkleSeconds}s`,
              "--drift-delay": `${m.driftDelay}s`,
              "--twinkle-delay": `${m.twinkleDelay}s`,
              "--rest": m.rest,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * Soft layered cloud, painted once per garden: high streaks, a few heaped
 * banks lit from above, and long bars of light low over the horizon.
 */
function SceneClouds({ palette, seed }: { palette: Palette; seed: string }) {
  const art = useMemo(() => {
    const random = seededRandom(hashString(`clouds:${seed}`));
    const streaks = Array.from({ length: 7 }, () => ({
      x: random() * 1600,
      y: lerp(30, 150, random()),
      rx: lerp(120, 340, random()),
      ry: lerp(3, 9, random()),
      o: lerp(0.18, 0.42, random()),
      tilt: lerp(-4, 2, random()),
    }));
    const banks = Array.from({ length: 4 }, (_, i) => {
      const x = (i + 0.2 + random() * 0.6) * 400;
      const y = lerp(150, 320, random());
      const w = lerp(140, 320, random());
      const puffs = Array.from({ length: 6 + Math.floor(random() * 4) }, () => {
        const t = random();
        return {
          x: x + (t - 0.5) * w * 1.5,
          y: y - Math.sin(t * Math.PI) * lerp(8, 30, random()),
          rx: lerp(50, 120, random()),
          ry: lerp(10, 22, random()),
        };
      });
      return { x, y, w, puffs };
    });
    const bars = Array.from({ length: 6 }, () => ({
      x: random() * 1600,
      y: lerp(372, 468, random()),
      rx: lerp(160, 420, random()),
      ry: lerp(3, 8, random()),
      o: lerp(0.3, 0.6, random()),
    }));
    return { streaks, banks, bars };
  }, [seed]);
  const id = `cl${hashString(seed).toString(36)}`;
  return (
    <svg
      className="scene-clouds"
      viewBox="0 0 1600 500"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${id}-bank`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={palette.cloud} />
          <stop offset=".55" stopColor={palette.cloud} stopOpacity=".9" />
          <stop offset="1" stopColor={palette.cloudShade} stopOpacity=".75" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-10%" y="-40%" width="120%" height="180%">
          <feGaussianBlur stdDeviation="6 4" />
        </filter>
        <filter id={`${id}-softer`} x="-10%" y="-200%" width="120%" height="500%">
          <feGaussianBlur stdDeviation="4 2" />
        </filter>
      </defs>
      <g filter={`url(#${id}-softer)`} fill={palette.cloud}>
        {art.streaks.map((c, i) => (
          <ellipse
            key={i}
            cx={c.x.toFixed(0)}
            cy={c.y.toFixed(0)}
            rx={c.rx.toFixed(0)}
            ry={c.ry.toFixed(1)}
            opacity={c.o.toFixed(2)}
            transform={`rotate(${c.tilt.toFixed(1)} ${c.x.toFixed(0)} ${c.y.toFixed(0)})`}
          />
        ))}
      </g>
      <g filter={`url(#${id}-soft)`}>
        {art.banks.map((bank, i) => (
          <g key={i} opacity=".88">
            <ellipse
              cx={bank.x.toFixed(0)}
              cy={(bank.y + 9).toFixed(0)}
              rx={(bank.w * 1.05).toFixed(0)}
              ry="10"
              fill={palette.cloudShade}
              opacity=".45"
            />
            <g fill={`url(#${id}-bank)`}>
              <ellipse
                cx={bank.x.toFixed(0)}
                cy={bank.y.toFixed(0)}
                rx={bank.w.toFixed(0)}
                ry="13"
              />
              {bank.puffs.map((p, j) => (
                <ellipse
                  key={j}
                  cx={p.x.toFixed(0)}
                  cy={p.y.toFixed(0)}
                  rx={p.rx.toFixed(0)}
                  ry={p.ry.toFixed(0)}
                />
              ))}
            </g>
          </g>
        ))}
      </g>
      <g filter={`url(#${id}-softer)`} fill={palette.horizonGlow}>
        {art.bars.map((c, i) => (
          <ellipse
            key={i}
            cx={c.x.toFixed(0)}
            cy={c.y.toFixed(0)}
            rx={c.rx.toFixed(0)}
            ry={c.ry.toFixed(1)}
            opacity={c.o.toFixed(2)}
          />
        ))}
      </g>
    </svg>
  );
}

function SceneLight({
  theta,
  metrics,
  palette,
  wash = false,
}: {
  theta: ReturnType<typeof useMotionValue<number>>;
  metrics: SceneMetrics | null;
  palette: ReturnType<typeof paletteFor>;
  /** The light's spill over the land, drawn above the hills. */
  wash?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const place = useCallback(
    (t: number) => {
      if (!ref.current || !metrics) return;
      // The light keeps its side of the sky and drifts a little as you turn.
      const x =
        metrics.width *
        (0.5 + palette.lightAngle / 200 - Math.sin((t * Math.PI) / 180) * 0.04);
      const y =
        metrics.horizonY * (1 - palette.lightHeight) - metrics.horizonY * 0.04;
      ref.current.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    },
    [metrics, palette],
  );
  useEffect(() => place(theta.get()), [place, theta]);
  useMotionValueEvent(theta, "change", place);
  return (
    <span
      ref={ref}
      className={`scene-light${palette.night ? " is-moon" : ""}`}
      aria-hidden="true"
    >
      {wash ? (
        <span className="scene-light-wash" />
      ) : (
        <>
          <span className="scene-light-halo" />
          <span className="scene-light-disc" />
        </>
      )}
    </span>
  );
}
