import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paletteFor } from "@/lib/garden/scene/palette";
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

function build() {
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
  });
  atmosphere.resize(390, 844);
  return { atmosphere, far, turn: (to: number) => (theta = to) };
}

beforeEach(() => {
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
