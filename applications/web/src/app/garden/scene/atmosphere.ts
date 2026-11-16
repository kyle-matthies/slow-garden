import { grassParallax, grassY, mod360, wrap } from "@/lib/garden/scene/camera";
import { lerp, seededRandom } from "@/lib/garden/scene/hash";
import type { Palette } from "@/lib/garden/scene/palette";

/**
 * The living backdrop: hills, ground, a dense meadow, wind in the near grass,
 * small wildflowers, and pollen by day or fireflies by night. It uses three
 * canvases and no library: the far layer (hills and meadow strips) and the
 * live grass behind the plants, and the near grass in front of them.
 *
 * The far meadow is pre-rendered once into wrapping strips and only slides
 * with parallax; its canvas is redrawn only when the camera turns, and the
 * ground beneath it is a CSS gradient. Only the nearer grass is redrawn with
 * wind each frame. The loop pauses whenever the page is hidden, the scene is
 * off screen, the person is writing, or reduced motion is requested; it then
 * draws one still frame.
 */
export type AtmosphereOptions = {
  palette: Palette;
  /** Garden seed: the same garden always has the same hills and meadow. */
  seed: number;
  /** Horizon as a fraction of the scene height. */
  horizon: number;
  fov: number;
  still: boolean;
  getTheta: () => number;
  /** How close the camera stands: the ground scales about the horizon. */
  getZoom?: () => number;
};

type Blade = {
  angle: number;
  depth: number;
  height: number;
  width: number;
  tone: number;
  stiffness: number;
  phase: number;
  flower: number;
};

type Hill = { amps: number[]; phases: number[]; freqs: number[]; base: number };

/** A tree on a far ridge: where it stands, how big, and its habit. */
type Tree = { deg: number; size: number; tall: boolean; shade: number };

function channels(colour: string): [number, number, number] {
  if (colour.startsWith("#")) {
    const n = parseInt(colour.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const [r = 0, g = 0, b = 0] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b];
}

/** Blend two colours; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number, alpha = 1) {
  const x = channels(a);
  const y = channels(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return alpha < 1
    ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`
    : `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

type Mote = {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  phase: number;
};

type Strip = {
  canvas: HTMLCanvasElement;
  /** Depth range covered, and the parallax factor used for the whole strip. */
  factor: number;
  top: number;
  scale: number;
};

const TAU = Math.PI * 2;
/** Wind-animated blades are scattered above this depth, over the painted strips. */
const LIVE_DEPTH = 0.52;
/**
 * Pre-rendered meadow bands: [from depth, to depth, tufts per 5200px, haze].
 * Distance is painted as soft washes with little blade detail and a veil of
 * mist; individual blades only become distinct near the viewer.
 */
const STRIP_BANDS: readonly [number, number, number, number][] = [
  [0, 0.1, 0, 0.2],
  [0.1, 0.24, 260, 0.14],
  [0.24, 0.42, 620, 0.08],
  [0.42, 0.64, 1100, 0.03],
  [0.64, 0.84, 1500, 0],
  [0.84, 1.02, 1700, 0],
];
/** Hill layers, far to near: height (of the ground), parallax, mist. */
const HILLS: readonly [number, number, number][] = [
  [0.17, 0.05, 0.62],
  [0.125, 0.09, 0.42],
  [0.09, 0.14, 0.24],
  [0.058, 0.2, 0.08],
  [0.03, 0.28, 0],
];

function hill(random: () => number, base: number, freqs: number[]): Hill {
  return {
    base,
    freqs,
    amps: freqs.map((f) => (0.4 + random() * 0.6) / Math.sqrt(f)),
    phases: freqs.map(() => random() * TAU),
  };
}

function hillHeight(h: Hill, deg: number) {
  const rad = (deg * Math.PI) / 180;
  let y = 0;
  let norm = 0;
  for (let i = 0; i < h.freqs.length; i++) {
    y += h.amps[i] * Math.sin(h.freqs[i] * rad + h.phases[i]);
    norm += h.amps[i];
  }
  return y / norm;
}

/** A smooth travelling wind field in -1..1. */
function windAt(x: number, t: number) {
  return (
    0.55 * Math.sin(0.0021 * x - 0.9 * t) +
    0.3 * Math.sin(0.0057 * x - 1.7 * t + 1.3) +
    0.15 * Math.sin(0.013 * x - 2.9 * t + 0.4)
  );
}

function gust(t: number) {
  return 0.55 + 0.45 * Math.sin(0.21 * t) * Math.sin(0.13 * t + 1);
}

const parallax = grassParallax;

function bladePath(
  p: Path2D,
  x: number,
  y: number,
  len: number,
  w: number,
  bend: number,
) {
  const tx = x + Math.sin(bend) * len;
  const ty = y - Math.cos(bend) * len;
  const cx = x + Math.sin(bend * 0.45) * len * 0.5;
  const cy = y - len * 0.56;
  p.moveTo(x - w, y);
  p.quadraticCurveTo(cx - w * 0.25, cy, tx, ty);
  p.quadraticCurveTo(cx + w * 0.25, cy, x + w, y);
  p.closePath();
  return [tx, ty] as const;
}

function rosette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colour: string,
  centre: string,
) {
  ctx.fillStyle = colour;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.beginPath();
    ctx.ellipse(
      x + Math.cos(a) * r * 0.55,
      y + Math.sin(a) * r * 0.42,
      r * 0.5,
      r * 0.32,
      a,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.fillStyle = centre;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.28, 0, TAU);
  ctx.fill();
}

export class GardenAtmosphere {
  private far: HTMLCanvasElement;
  private back: HTMLCanvasElement;
  private front: HTMLCanvasElement;
  private actx: CanvasRenderingContext2D;
  private bctx: CanvasRenderingContext2D;
  private fctx: CanvasRenderingContext2D;
  private opts: AtmosphereOptions;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private live: Blade[] = [];
  private near: Blade[] = [];
  private hills: Hill[] = [];
  private trees: Tree[] = [];
  private farZoom = NaN;
  private motes: Mote[] = [];
  private strips: Strip[] = [];
  private stripKey = "";
  private frame = 0;
  private running = false;
  private visible = true;
  private quality = 1;
  /** Backing-store resolution multiplier, lowered only after quality bottoms out. */
  private resolution = 1;
  private frameTimes: number[] = [];
  private intervals: number[] = [];
  private lastFrame = 0;
  private windowStart = 0;
  /** Camera angle the far layer was last drawn at; NaN forces a redraw. */
  private farTheta = NaN;
  private groundCss = "";
  private start = performance.now();
  private observer: IntersectionObserver | null = null;

  constructor(
    far: HTMLCanvasElement,
    back: HTMLCanvasElement,
    front: HTMLCanvasElement,
    opts: AtmosphereOptions,
  ) {
    this.far = far;
    this.back = back;
    this.front = front;
    this.actx = far.getContext("2d", { alpha: true })!;
    this.bctx = back.getContext("2d", { alpha: true })!;
    this.fctx = front.getContext("2d", { alpha: true })!;
    this.opts = opts;
    this.generate();
    document.addEventListener("visibilitychange", this.onVisibility);
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(([entry]) => {
        this.visible = entry.isIntersecting;
        this.sync();
      });
      this.observer.observe(back);
    }
  }

  update(next: Partial<AtmosphereOptions>) {
    const reseed = next.seed !== undefined && next.seed !== this.opts.seed;
    this.opts = { ...this.opts, ...next };
    this.farTheta = NaN;
    if (reseed) this.generate();
    this.sync();
    if (!this.running) this.draw(this.time());
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.size();
    this.sync();
    this.draw(this.time());
  }

  private size() {
    const { width, height } = this;
    const ideal = Math.min(window.devicePixelRatio || 1, 2);
    // Keep the backing store near 4.5 megapixels on very large screens.
    this.dpr =
      Math.min(ideal, Math.sqrt(4_500_000 / Math.max(1, width * height))) *
      this.resolution;
    for (const canvas of [this.far, this.back, this.front]) {
      canvas.width = Math.round(width * this.dpr);
      canvas.height = Math.round(height * this.dpr);
    }
    this.farTheta = NaN;
  }

  /** Redraw now, e.g. while the camera moves during a still or paused state. */
  redraw() {
    if (!this.running) this.draw(this.time());
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.frame);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.observer?.disconnect();
  }

  private onVisibility = () => this.sync();

  private time() {
    return this.opts.still ? 12.5 : (performance.now() - this.start) / 1000;
  }

  private sync() {
    const shouldRun =
      !this.opts.still &&
      this.visible &&
      this.width > 0 &&
      document.visibilityState === "visible";
    if (shouldRun && !this.running) {
      this.running = true;
      this.lastFrame = 0;
      this.frame = requestAnimationFrame(this.loop);
    } else if (!shouldRun && this.running) {
      this.running = false;
      cancelAnimationFrame(this.frame);
      this.draw(this.time());
    }
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const interval = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    const before = performance.now();
    this.draw((now - this.start) / 1000);
    this.adapt(performance.now() - before, interval);
    this.frame = requestAnimationFrame(this.loop);
  };

  /**
   * Thin the live grass, then soften the canvas resolution, while drawing or
   * frame pacing stays slow (rasterising happens after draw(), so the frame
   * interval is the honest signal); restore both with headroom.
   */
  private adapt(cost: number, interval: number) {
    const now = performance.now();
    if (!this.frameTimes.length) this.windowStart = now;
    this.frameTimes.push(cost);
    // Ignore pauses such as a backgrounded tab or a long route change.
    if (interval > 0 && interval < 250) this.intervals.push(interval);
    // Decide every 60 frames, or every second on a device too slow to reach 60.
    const enough =
      this.frameTimes.length >= 60 ||
      (this.frameTimes.length >= 10 && now - this.windowStart >= 1000);
    if (!enough) return;
    const p90 = (list: number[]) =>
      [...list].sort((a, b) => a - b)[Math.floor(list.length * 0.9)] ?? 0;
    const cost90 = p90(this.frameTimes);
    const pace90 = p90(this.intervals);
    this.frameTimes = [];
    this.intervals = [];
    if (cost90 > 8 || pace90 > 24) {
      if (this.quality > 0.35)
        this.quality = Math.max(0.35, this.quality * 0.7);
      else if (this.resolution > 0.5) {
        this.resolution = Math.max(0.5, this.resolution * 0.75);
        this.size();
      }
    } else if (cost90 < 3.5 && pace90 < 18) {
      if (this.resolution < 1) {
        this.resolution = Math.min(1, this.resolution / 0.75);
        this.size();
      } else if (this.quality < 1)
        this.quality = Math.min(1, this.quality * 1.15);
    }
  }

  private generate() {
    const random = seededRandom(this.opts.seed);
    this.hills = [
      hill(random, 0.02, [1, 2, 3]),
      hill(random, 0.015, [1, 3, 5, 7]),
      hill(random, 0.012, [2, 3, 7, 11]),
      hill(random, 0.01, [3, 4, 6, 9]),
      hill(random, 0.004, [2, 5, 8]),
    ];
    // Copses and hedgerow trees along the nearer ridge, gathered in groups.
    const wood = seededRandom(this.opts.seed ^ 0x7ee5);
    const trees: Tree[] = [];
    for (let group = 0; group < 46; group++) {
      const centre = wood() * 360;
      const spread = 2 + wood() * 9;
      const count = 2 + Math.floor(wood() * 7);
      for (let i = 0; i < count; i++)
        trees.push({
          deg: centre + (wood() - 0.5) * spread,
          size: lerp(0.55, 1.25, wood()),
          tall: wood() > 0.86,
          shade: wood(),
        });
    }
    this.trees = trees;
    const blade = (depth: number): Blade => ({
      angle: random() * 360,
      depth,
      height: lerp(0.65, 1.25, random()),
      width: lerp(0.7, 1.3, random()),
      tone: random(),
      stiffness: random(),
      phase: random() * TAU,
      flower: random(),
    });
    const live: Blade[] = [];
    for (let i = 0; i < 3000; i++)
      live.push(blade(lerp(LIVE_DEPTH, 1, Math.pow(random(), 0.7))));
    live.sort((a, b) => a.depth - b.depth);
    this.live = live;
    const near: Blade[] = [];
    for (let i = 0; i < 260; i++) near.push(blade(1 + random() * 0.3));
    near.sort((a, b) => a.depth - b.depth);
    this.near = near;
    this.stripKey = "";
    this.farTheta = NaN;
    const motes = seededRandom(this.opts.seed ^ 0x51ed);
    this.motes = Array.from({ length: 36 }, () => ({
      x: motes(),
      y: motes(),
      r: lerp(0.8, 2.2, motes()),
      vx: lerp(-0.004, 0.012, motes()),
      vy: lerp(-0.006, 0.004, motes()),
      phase: motes() * TAU,
    }));
  }

  private geometry() {
    const { width: W, height: H } = this;
    const { horizon, fov } = this.opts;
    const hy = H * horizon;
    const groundH = H - hy;
    return {
      W,
      H,
      hy,
      groundH,
      ppd: W / fov,
      scale: Math.min(1.6, Math.max(0.7, H / 820)),
      yFor: (depth: number) => hy + groundH * grassY(depth),
      lenFor: (depth: number) => lerp(3, 44, Math.pow(depth, 1.15)),
      widthFor: (depth: number) => lerp(0.7, 3.4, depth),
    };
  }

  /** Pre-render the far meadow into wrapping strips, one per depth band. */
  private ensureStrips() {
    const { palette, fov, horizon, seed } = this.opts;
    const key = `${this.width}x${this.height}:${palette.name}:${fov}:${horizon}:${seed}`;
    if (key === this.stripKey) return;
    this.stripKey = key;
    const g = this.geometry();
    const period = 360 * g.ppd;
    // Strips are texture, not detail: render near CSS resolution and cap width.
    const scale = Math.min(this.dpr, 1.25, 8192 / period);
    const random = seededRandom(seed ^ 0x2f00);
    const tones = palette.grass;
    this.strips = STRIP_BANDS.map(([d0, d1, density, haze]) => {
      const top = g.yFor(d0) - g.lenFor(d1) * 1.3 * g.scale - 4;
      const bottom = g.yFor(d1) + 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(period * scale);
      canvas.height = Math.ceil((bottom - top) * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(scale, 0, 0, scale, 0, -top * scale);
      const mid = (d0 + d1) / 2;
      const toneAt = (depth: number, jitter: number) =>
        Math.min(
          tones.length - 1,
          Math.max(0, Math.round(depth * (tones.length - 1) + jitter)),
        );
      const wraps = (x: number, reach: number) =>
        x < reach ? [0, period] : x > period - reach ? [0, -period] : [0];

      // Broad, soft washes: drifts of paler and deeper meadow, like brush
      // strokes laid along the ground.
      const washes = Math.round((period / 1000) * lerp(7, 4, mid));
      for (let i = 0; i < washes; i++) {
        const depth = lerp(d0, d1, random());
        const x = random() * period;
        const y = g.yFor(depth);
        const rx = lerp(70, 260, depth) * lerp(0.6, 1.5, random()) * g.scale;
        const ry =
          Math.max(2, (bottom - top) * lerp(0.1, 0.3, random())) *
          lerp(0.5, 1, depth);
        const lightWash = random() > 0.45;
        ctx.fillStyle = lightWash
          ? mix(tones[toneAt(depth, -1)], palette.light, 0.22)
          : tones[toneAt(depth, 1)];
        ctx.globalAlpha = lerp(0.2, 0.13, depth);
        for (const ox of wraps(x, rx)) {
          ctx.beginPath();
          ctx.ellipse(x + ox, y, rx, ry, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Grass in tufts, close in tone to the ground they stand on.
      const count = Math.round(density * (period / 5200));
      const paths = tones.map(() => new Path2D());
      for (let i = 0; i < count; i++) {
        const depth = lerp(d0, d1, random());
        const cx = random() * period;
        const blades = 3 + Math.floor(random() * 4);
        const tone = toneAt(depth, (random() - 0.5) * 1.5);
        const spread = lerp(3, 16, depth) * g.scale;
        for (let k = 0; k < blades; k++) {
          const x = cx + (random() - 0.5) * spread;
          const y = g.yFor(depth) + (random() - 0.5) * 2;
          const len = g.lenFor(depth) * lerp(0.6, 1.25, random()) * g.scale;
          const w = g.widthFor(depth) * lerp(0.7, 1.2, random()) * g.scale;
          const bend = 0.06 + (k / blades - 0.5) * 0.7 + (random() - 0.5) * 0.2;
          for (const ox of wraps(x, 60))
            bladePath(paths[tone], x + ox, y, len, w, bend);
        }
      }
      ctx.globalAlpha = lerp(0.55, 0.95, mid);
      paths.forEach((p, i) => {
        ctx.fillStyle = tones[i];
        ctx.fill(p);
      });
      ctx.globalAlpha = 1;

      // Wildflowers gather in drifts, not evenly like noise.
      const drifts = Math.round((period / 1000) * 1.4);
      for (let i = 0; i < drifts; i++) {
        const depth = lerp(d0, d1, random());
        const cx = random() * period;
        const colour =
          palette.specks[Math.floor(random() * palette.specks.length)];
        const reach = lerp(40, 150, depth) * g.scale;
        const flowers = 5 + Math.floor(random() * 9);
        for (let k = 0; k < flowers; k++) {
          const x = cx + (random() + random() - 1) * reach;
          const dd = Math.min(
            d1,
            Math.max(d0, depth + (random() - 0.5) * 0.06),
          );
          const y = g.yFor(dd) - g.lenFor(dd) * 0.7 * g.scale;
          const r = lerp(0.7, 3.6, dd) * g.scale;
          ctx.globalAlpha = lerp(0.55, 0.95, dd);
          if (r < 1.8) {
            ctx.fillStyle = colour;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
          } else
            rosette(
              ctx,
              x,
              y,
              r,
              colour,
              palette.night ? "#7d7a5a" : "#e9d9a0",
            );
        }
      }
      // Atmospheric haze, strongest near the horizon.
      ctx.globalAlpha = haze;
      ctx.fillStyle = palette.mist;
      ctx.fillRect(0, top, period, bottom - top);
      ctx.globalAlpha = 1;
      return { canvas, factor: parallax(mid), top, scale };
    });
  }

  /** Hills and the far meadow strips: they move only when the camera turns. */
  private drawFar(theta: number, zoom: number) {
    const { width: W, height: H } = this;
    const { palette, horizon } = this.opts;
    const { hy, groundH, ppd } = this.geometry();
    const a = this.actx;
    a.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    a.clearRect(0, 0, W, H);

    // Ground: a CSS gradient under this canvas. It starts in the mist of the
    // nearest ridge and deepens toward the viewer, and never repaints.
    const h = horizon * 100;
    const at = (f: number) =>
      `${Math.min(100, h + f * zoom * (100 - h)).toFixed(2)}%`;
    const ground = `linear-gradient(transparent ${h}%, ${mix(palette.near, palette.mist, 0.2)} ${h}%, ${mix(palette.groundTop, palette.mist, 0.1)} ${at(0.1)}, ${palette.groundTop} ${at(0.26)}, ${mix(palette.groundTop, palette.groundBottom, 0.6)} ${at(0.72)}, ${palette.groundBottom})`;
    if (ground !== this.groundCss) {
      this.groundCss = ground;
      this.far.style.background = ground;
    }

    // Hills, far to near. Each fades toward the mist at its foot and the
    // farther ones are paler: atmospheric perspective.
    const base = [
      palette.far,
      palette.far,
      palette.treeline,
      palette.treeline,
      palette.near,
    ];
    const ridgeY = (i: number, deg: number) =>
      hy -
      groundH *
        (this.hills[i].base +
          HILLS[i][0] * (0.5 + 0.5 * hillHeight(this.hills[i], deg)));
    this.hills.forEach((_, i) => {
      const [height, factor, mistAmount] = HILLS[i];
      const shift = mod360(theta * factor);
      a.beginPath();
      a.moveTo(0, hy + 2);
      for (let x = 0; x <= W + 8; x += 8) {
        const deg = shift + (x - W / 2) / ppd;
        let y = ridgeY(i, deg);
        if (i === 2) {
          // A soft, wooded crest.
          const crown =
            Math.abs(Math.sin((deg * Math.PI) / 4.5)) *
            Math.abs(Math.sin((deg * Math.PI) / 11));
          y -= crown * groundH * 0.018;
        }
        a.lineTo(x, y);
      }
      a.lineTo(W, hy + 2);
      a.closePath();
      const colour = mix(base[i], palette.mist, mistAmount);
      const top = hy - groundH * (height + 0.03);
      const fill = a.createLinearGradient(0, top, 0, hy + 2);
      fill.addColorStop(0, mix(colour, palette.light, i < 4 ? 0.1 : 0.06));
      fill.addColorStop(0.45, colour);
      fill.addColorStop(
        1,
        mix(colour, palette.mist, i === 4 ? 0.2 : 0.34 + mistAmount * 0.3),
      );
      a.fillStyle = fill;
      a.fill();

      if (i !== 3) return;
      // Trees stand along this ridge in copses.
      const dark = mix(palette.treeline, "#0c1410", palette.night ? 0.3 : 0.22);
      const lit = mix(palette.treeline, palette.light, 0.2);
      const unit = groundH * 0.019;
      for (const tree of this.trees) {
        const rel = wrap(tree.deg - shift);
        const x = W / 2 + rel * ppd;
        if (x < -30 || x > W + 30) continue;
        const r = unit * tree.size;
        const y = ridgeY(3, tree.deg) + r * 0.35;
        a.fillStyle = mix(dark, palette.mist, 0.1 + tree.shade * 0.16);
        a.beginPath();
        if (tree.tall) a.ellipse(x, y - r * 1.5, r * 0.5, r * 1.9, 0, 0, TAU);
        else {
          a.arc(x, y - r * 0.9, r, 0, TAU);
          a.arc(x - r * 0.75, y - r * 0.45, r * 0.7, 0, TAU);
          a.arc(x + r * 0.8, y - r * 0.5, r * 0.72, 0, TAU);
        }
        a.fill();
        a.fillStyle = lit;
        a.globalAlpha = 0.3;
        a.beginPath();
        if (tree.tall)
          a.ellipse(x - r * 0.12, y - r * 1.9, r * 0.24, r * 1.1, 0, 0, TAU);
        else a.arc(x - r * 0.3, y - r * 1.15, r * 0.55, 0, TAU);
        a.fill();
        a.globalAlpha = 1;
      }
    });

    // Far meadow strips slide with parallax; stepping closer scales the
    // ground about the horizon.
    a.setTransform(
      this.dpr * zoom,
      0,
      0,
      this.dpr * zoom,
      this.dpr * (W / 2) * (1 - zoom),
      this.dpr * hy * (1 - zoom),
    );
    const left = W / 2 - W / 2 / zoom;
    const right = W / 2 + W / 2 / zoom;
    const period = 360 * ppd;
    for (const strip of this.strips) {
      const sw = strip.canvas.width / strip.scale;
      const sh = strip.canvas.height / strip.scale;
      if (hy + (strip.top - hy) * zoom > H) continue;
      let ox = W / 2 - mod360(theta * strip.factor) * ppd;
      while (ox > left) ox -= period;
      for (let x = ox; x < right; x += period)
        a.drawImage(strip.canvas, x, strip.top, sw, sh);
    }
    a.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private draw(t: number) {
    const { width: W, height: H } = this;
    if (!W || !H) return;
    this.ensureStrips();
    const { palette, fov } = this.opts;
    const g = this.geometry();
    const { hy, groundH, ppd, scale } = g;
    const theta = this.opts.getTheta();
    const zoom = this.opts.getZoom?.() ?? 1;
    const gu = this.opts.still ? 0.4 : gust(t);
    if (theta !== this.farTheta || zoom !== this.farZoom) {
      this.drawFar(theta, zoom);
      this.farTheta = theta;
      this.farZoom = zoom;
    }
    const b = this.bctx;
    const f = this.fctx;
    b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    f.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    b.clearRect(0, 0, W, H);
    f.clearRect(0, 0, W, H);
    // The live grass shares the ground's zoom about the horizon.
    b.setTransform(
      this.dpr * zoom,
      0,
      0,
      this.dpr * zoom,
      this.dpr * (W / 2) * (1 - zoom),
      this.dpr * hy * (1 - zoom),
    );
    const reach = fov / 2 / zoom + 3;
    const lowest = hy + (H - hy) / zoom + 60;

    // Live grass with wind, batched by tone.
    const tones = palette.grass;
    const quality = this.quality * Math.min(1, (W * H) / (1280 * 760) + 0.4);
    const stride = Math.max(1, Math.round(1 / quality));
    const paths = tones.map(() => new Path2D());
    const tips = new Path2D();
    const flowers: { x: number; y: number; r: number; c: string }[] = [];
    for (let i = 0; i < this.live.length; i += stride) {
      const blade = this.live[i];
      const rel = wrap(blade.angle - theta * parallax(blade.depth));
      if (Math.abs(rel) > reach) continue;
      const x = W / 2 + rel * ppd;
      const y = g.yFor(blade.depth);
      if (y > lowest) continue;
      const len = g.lenFor(blade.depth) * blade.height * scale;
      const w = g.widthFor(blade.depth) * blade.width * scale;
      const bend =
        0.1 +
        (0.22 + 0.18 * blade.height) *
          gu *
          windAt(x, t) *
          (1.2 - blade.stiffness) +
        Math.sin(t * 1.3 + blade.phase) * 0.03 * gu;
      const toneIndex = Math.min(
        tones.length - 1,
        Math.max(
          0,
          Math.floor(
            blade.depth * (tones.length - 1) + (blade.tone - 0.5) * 1.5,
          ),
        ),
      );
      const [tx, ty] = bladePath(paths[toneIndex], x, y, len, w, bend);
      if (blade.tone > 0.7 && blade.depth > 0.78) {
        // Sunlit tips: a fine lighter stroke along the upper blade.
        tips.moveTo(x + Math.sin(bend * 0.6) * len * 0.55, y - len * 0.55);
        tips.lineTo(tx, ty);
      }
      if (blade.flower > 0.991)
        flowers.push({
          x: tx,
          y: ty,
          r: lerp(2.2, 5.5, blade.depth) * scale,
          c: palette.specks[Math.floor(blade.tone * palette.specks.length)],
        });
    }
    paths.forEach((p, i) => {
      b.fillStyle = tones[i];
      b.fill(p);
    });
    b.strokeStyle = palette.night
      ? "rgba(150, 180, 170, 0.18)"
      : "rgba(235, 245, 200, 0.22)";
    b.lineWidth = 0.8 * scale;
    b.stroke(tips);
    for (const fl of flowers)
      rosette(b, fl.x, fl.y, fl.r, fl.c, palette.night ? "#8a8560" : "#e9c64a");

    b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Foreground grass in front of the plants.
    const nearPath = new Path2D();
    const nearDark = new Path2D();
    const nearStride = this.quality < 0.5 ? 2 : 1;
    for (let i = 0; i < this.near.length; i += nearStride) {
      const blade = this.near[i];
      const rel = wrap(blade.angle - theta * (1.25 + (blade.depth - 1) * 0.8));
      if (Math.abs(rel) > fov / 2 + 4) continue;
      const x = W / 2 + rel * ppd;
      const len = lerp(40, 120, blade.depth - 1) * blade.height * scale;
      const w = lerp(2.6, 5.2, blade.depth - 1) * blade.width * scale;
      const bend =
        0.12 +
        0.3 * gu * windAt(x, t) * (1.2 - blade.stiffness) +
        Math.sin(t * 1.1 + blade.phase) * 0.04 * gu;
      bladePath(blade.tone > 0.5 ? nearPath : nearDark, x, H + 4, len, w, bend);
    }
    f.fillStyle = tones[tones.length - 2];
    f.fill(nearPath);
    f.fillStyle = tones[tones.length - 1];
    f.fill(nearDark);

    // Pollen by day, fireflies at night.
    const night = palette.night;
    f.fillStyle = palette.particle;
    for (const m of this.motes) {
      const mx = (((m.x + (this.opts.still ? 0 : m.vx * t)) % 1) + 1) % 1;
      const my =
        (((m.y +
          (this.opts.still
            ? 0
            : m.vy * t + 0.01 * Math.sin(t * 0.7 + m.phase))) %
          1) +
          1) %
        1;
      const x = mx * W + windAt(mx * W, t) * 6 * gu;
      const y = hy - groundH * 0.1 + my * groundH * 0.95;
      const twinkle = night
        ? Math.max(0, Math.sin(t * 0.9 + m.phase)) ** 3
        : 0.45 + 0.35 * Math.sin(t * 1.4 + m.phase);
      if (twinkle < 0.02) continue;
      f.globalAlpha = twinkle;
      f.beginPath();
      f.arc(x, y, m.r * scale * (night ? 1.1 : 0.8), 0, TAU);
      f.fill();
      if (night) {
        f.globalAlpha = twinkle * 0.22;
        f.beginPath();
        f.arc(x, y, m.r * scale * 4, 0, TAU);
        f.fill();
      }
    }
    f.globalAlpha = 1;
  }
}
