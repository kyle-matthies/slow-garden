import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paletteFor } from "@/lib/garden/scene/palette";
import { FLOOR, QUALITY_KEY, remember } from "@/lib/garden/scene/quality";
import { GardenAtmosphere } from "./atmosphere";

/**
 * The resting meadow must cost nothing on the main thread: the canvases are
 * drawn once and wait. Frames are requested only while the camera moves, one
 * per display frame however many camera changes arrive.
 */
const noop = () => {};
function context() {
  const gradient = { addColorStop: noop };
  return new Proxy(
    {},
    {
      get: (_t, key) =>
        key === "createLinearGradient" || key === "createRadialGradient"
          ? () => gradient
          : noop,
      set: () => true,
    },
  );
}

let frames: Array<(now: number) => void>;
let clears: ReturnType<typeof vi.fn>;
function canvas() {
  const element = document.createElement("canvas");
  const ctx = context() as unknown as Record<string, unknown>;
  const drawn = new Proxy(ctx, {
    get: (target, key) => (key === "clearRect" ? clears : Reflect.get(target, key)),
    set: () => true,
  });
  element.getContext = (() => drawn) as unknown as HTMLCanvasElement["getContext"];
  return element;
}

function build(settle = false) {
  let theta = 0;
  const far = canvas();
  const back = canvas();
  const front = canvas();
  const atmosphere = new GardenAtmosphere(far, back, front, {
    palette: paletteFor("garden-1", false),
    seed: 7,
    horizon: 0.42,
    fov: 88,
    getTheta: () => theta,
    settle,
  });
  atmosphere.resize(390, 844);
  return { atmosphere, far, turn: (to: number) => (theta = to) };
}

beforeEach(() => {
  window.localStorage.clear();
  frames = [];
  clears = vi.fn();
  vi.stubGlobal("Path2D", class { moveTo = noop; lineTo = noop; quadraticCurveTo = noop; bezierCurveTo = noop; closePath = noop; arc = noop; ellipse = noop; });
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = noop;
  });
  const real = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const element = real(tag);
    if (tag === "canvas")
      (element as HTMLCanvasElement).getContext = (() => context()) as unknown as HTMLCanvasElement["getContext"];
    return element;
  }) as typeof document.createElement);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the resting atmosphere", () => {
  it("draws once and asks for no animation frame while nothing moves", () => {
    build();
    expect(clears).toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  it("asks for one frame per display frame while the camera turns, then rests again", () => {
    const { atmosphere, turn } = build();
    clears.mockClear();
    turn(4);
    atmosphere.redraw();
    turn(5);
    atmosphere.redraw();
    atmosphere.redraw();
    expect(frames).toHaveLength(1);
    expect(clears).not.toHaveBeenCalled();
    frames[0](16);
    expect(clears).toHaveBeenCalled();
    // Nothing follows unless the camera moves again.
    expect(frames).toHaveLength(1);
    atmosphere.redraw();
    expect(frames).toHaveLength(2);
  });

  it("cancels a pending frame when it is destroyed", () => {
    const { atmosphere } = build();
    atmosphere.redraw();
    atmosphere.destroy();
    clears.mockClear();
    frames[0](16);
    expect(clears).not.toHaveBeenCalled();
  });

  it("paints again when a slow camera move lowers the canvas resolution on its last frame", () => {
    const { atmosphere, far, turn } = build();
    let now = 1000;
    let resizedAt = -1;
    for (let step = 1; step <= 900 && resizedAt < 0; step++) {
      const width = far.width;
      turn(step);
      atmosphere.redraw();
      const paintsBefore = clears.mock.calls.length;
      frames[frames.length - 1]((now += 40));
      if (far.width !== width) {
        resizedAt = step;
        // draw() ran once before the resize; a second must follow it.
        expect(clears.mock.calls.length - paintsBefore).toBeGreaterThan(3);
      }
    }
    expect(resizedAt).toBeGreaterThan(0);
    expect(frames.filter((f) => f !== noop).length).toBe(resizedAt);
  });
});

describe("settling quality before the first touch", () => {
  const live = () => frames.filter((f) => f !== noop).length;
  /** Run the burst at a steady frame interval until it asks for no more frames. */
  function burst(interval: number) {
    let now = 5000;
    let ran = 0;
    while (ran < frames.length && ran < 500) frames[ran++]((now += interval));
    return ran;
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  it("a scene nobody turns schedules nothing at all", () => {
    build(false);
    vi.advanceTimersByTime(5000);
    expect(frames).toHaveLength(0);
  });

  it("waits for the page to arrive, judges one short window, and rests at full quality on a device that keeps pace", () => {
    const { far } = build(true);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(299);
    expect(frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(frames).toHaveLength(1);
    const width = far.width;
    // Eight intervals need nine frames; then nothing more is requested.
    expect(burst(16.7)).toBe(9);
    expect(live()).toBe(9);
    expect(far.width).toBe(width);
    expect(JSON.parse(window.localStorage.getItem(QUALITY_KEY)!)).toMatchObject({ q: 1, r: 1 });
  });

  it("goes straight to the floor on a device that never keeps pace, in about a second of frames, and paints the result", () => {
    const { far } = build(true);
    const width = far.width;
    vi.advanceTimersByTime(300);
    clears.mockClear();
    const ran = burst(33.4);
    expect(ran).toBeLessThanOrEqual(30);
    expect(far.width).toBe(Math.round(width * FLOOR.resolution));
    expect(JSON.parse(window.localStorage.getItem(QUALITY_KEY)!)).toMatchObject({ q: FLOOR.quality, r: FLOOR.resolution });
    // Resting again: no frame is pending, and the last choice was painted.
    expect(frames).toHaveLength(ran);
    expect(clears.mock.calls.length).toBeGreaterThan(ran * 2);
  });

  it("starts where this device settled last time, without a burst", () => {
    const ideal = Math.min(window.devicePixelRatio || 1, 2);
    remember(window.localStorage, FLOOR, 390 * 844 * ideal * ideal);
    const settled = build(true);
    const fresh = (window.localStorage.clear(), build(false));
    expect(settled.far.width).toBe(Math.round(fresh.far.width * FLOOR.resolution));
    vi.advanceTimersByTime(5000);
    expect(frames).toHaveLength(0);
  });

  it("a camera move during the burst shares its frames, and destroying the scene ends it", () => {
    const { atmosphere, turn } = build(true);
    vi.advanceTimersByTime(300);
    turn(3);
    atmosphere.redraw();
    expect(frames).toHaveLength(1);
    frames[0](5016);
    expect(frames).toHaveLength(2);
    atmosphere.destroy();
    frames[1](5033);
    expect(frames).toHaveLength(2);

    const late = build(true);
    late.atmosphere.destroy();
    vi.advanceTimersByTime(5000);
    expect(frames).toHaveLength(2);
  });
});
