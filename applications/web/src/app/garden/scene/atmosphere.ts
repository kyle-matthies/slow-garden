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
/** Wind-animated blades are scattered above this depth, over the dense strips. */
const LIVE_DEPTH = 0.3;
/** Dense, pre-rendered meadow bands: [from depth, to depth, blades per 5200px]. */
const STRIP_BANDS: readonly [number, number, number][] = [
  [0, 0.08, 5200],
  [0.08, 0.2, 5600],
  [0.2, 0.36, 6400],
  [0.36, 0.58, 7600],
  [0.58, 0.8, 8200],
  [0.8, 1.02, 8600],
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
      hill(random, 0, [1, 2, 3, 5]),
      hill(random, 0.02, [2, 3, 7, 11]),
      hill(random, 0.035, [3, 4, 6, 9]),
    ];
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
    for (let i = 0; i < 4200; i++)
      live.push(blade(lerp(LIVE_DEPTH, 1, Math.pow(random(), 0.8))));
    live.sort((a, b) => a.depth - b.depth);
    this.live = live;
    const near: Blade[] = [];
    for (let i = 0; i < 300; i++) near.push(blade(1 + random() * 0.3));
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
    this.strips = STRIP_BANDS.map(([d0, d1, density], band) => {
      const top = g.yFor(d0) - g.lenFor(d1) * 1.3 * g.scale - 4;
      const bottom = g.yFor(d1) + 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(period * scale);
      canvas.height = Math.ceil((bottom - top) * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(scale, 0, 0, scale, 0, -top * scale);
      const count = Math.round(density * (period / 5200));
      const paths = tones.map(() => new Path2D());
      const flowers: { x: number; y: number; r: number; c: string }[] = [];
      for (let i = 0; i < count; i++) {
        const depth = lerp(d0, d1, random());
        const x = random() * period;
        const y = g.yFor(depth);
        const len = g.lenFor(depth) * lerp(0.6, 1.25, random()) * g.scale;
        const w = g.widthFor(depth) * lerp(0.7, 1.2, random()) * g.scale;
        const bend = 0.08 + (random() - 0.4) * 0.5;
        const toneIndex = Math.min(
          tones.length - 1,
          Math.max(
            0,
            Math.floor(depth * (tones.length - 1) + (random() - 0.5) * 2.6),
          ),
        );
        for (const ox of x < 60
          ? [0, period]
          : x > period - 60
            ? [0, -period]
            : [0]) {
          const [tx, ty] = bladePath(paths[toneIndex], x + ox, y, len, w, bend);
          if (ox === 0 && random() > 0.982)
            flowers.push({
              x: tx,
              y: ty,
              r: lerp(1, 4.2, depth) * g.scale,
              c: palette.specks[Math.floor(random() * palette.specks.length)],
            });
        }
      }
      paths.forEach((p, i) => {
        ctx.fillStyle = tones[i];
        ctx.fill(p);
      });
      for (const f of flowers) {
        if (f.r < 1.6) {
          ctx.fillStyle = f.c;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, TAU);
          ctx.fill();
        } else
          rosette(
            ctx,
            f.x,
            f.y,
            f.r,
            f.c,
            palette.night ? "#7d7a5a" : "#e8c547",
          );
      }
      // Atmospheric haze, strongest near the horizon.
      ctx.globalAlpha = Math.max(0, 0.42 - band * 0.12);
      ctx.fillStyle = palette.haze;
      ctx.fillRect(0, top, period, bottom - top);
      ctx.globalAlpha = 1;
      return { canvas, factor: parallax((d0 + d1) / 2), top, scale };
    });
  }

  /** Hills and the far meadow strips: they move only when the camera turns. */
  private drawFar(theta: number) {
    const { width: W, height: H } = this;
    const { palette, horizon } = this.opts;
    const { hy, groundH, ppd } = this.geometry();
    const a = this.actx;
    a.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    a.clearRect(0, 0, W, H);

    // Ground: a CSS gradient under this canvas, continuing the nearest ridge's
    // colour so there is no seam. It never needs repainting per frame.
    const h = horizon * 100;
    const ground = `linear-gradient(transparent ${h}%, ${palette.near} ${h}%, ${palette.groundTop} ${h + 0.18 * (100 - h)}%, ${palette.groundBottom})`;
    if (ground !== this.groundCss) {
      this.groundCss = ground;
      this.far.style.background = ground;
    }

    // Hills, far to near, each with its own parallax.
    const hillStyles = [palette.far, palette.treeline, palette.near];
    const factors = [0.08, 0.16, 0.26];
    const heights = [0.2, 0.13, 0.08];
    this.hills.forEach((hill, i) => {
      const shift = mod360(theta * factors[i]);
      a.beginPath();
      a.moveTo(0, hy + 2);
      for (let x = 0; x <= W + 8; x += 8) {
        const deg = shift + (x - W / 2) / ppd;
        let y =
          hy -
          groundH *
            (hill.base + heights[i] * (0.55 + 0.45 * hillHeight(hill, deg)));
        if (i === 1) {
          const crown =
            Math.abs(Math.sin((deg * Math.PI) / 4.5)) *
            Math.abs(Math.sin((deg * Math.PI) / 11));
          y -= crown * groundH * 0.03;
        }
        a.lineTo(x, y);
      }
      a.lineTo(W, hy + 2);
      a.closePath();
      a.fillStyle = hillStyles[i];
      a.fill();
      if (i < 2) {
        a.fillStyle = palette.haze;
        a.globalAlpha = i === 0 ? 0.55 : 0.3;
        a.fill();
        a.globalAlpha = 1;
      }
    });

    // Far meadow strips slide with parallax.
    for (const strip of this.strips) {
      const period = 360 * ppd;
      let ox = W / 2 - mod360(theta * strip.factor) * ppd;
      while (ox > 0) ox -= period;
      const sw = strip.canvas.width / strip.scale;
      const sh = strip.canvas.height / strip.scale;
      for (let x = ox; x < W; x += period)
        a.drawImage(strip.canvas, x, strip.top, sw, sh);
    }
  }

  private draw(t: number) {
    const { width: W, height: H } = this;
    if (!W || !H) return;
    this.ensureStrips();
    const { palette, fov } = this.opts;
    const g = this.geometry();
    const { hy, groundH, ppd, scale } = g;
    const theta = this.opts.getTheta();
    const gu = this.opts.still ? 0.4 : gust(t);
    if (theta !== this.farTheta) {
      this.drawFar(theta);
      this.farTheta = theta;
    }
    const b = this.bctx;
    const f = this.fctx;
    b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    f.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    b.clearRect(0, 0, W, H);
    f.clearRect(0, 0, W, H);

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
      if (Math.abs(rel) > fov / 2 + 3) continue;
      const x = W / 2 + rel * ppd;
      const y = g.yFor(blade.depth);
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
            blade.depth * (tones.length - 1) + (blade.tone - 0.5) * 2.4,
          ),
        ),
      );
      const [tx, ty] = bladePath(paths[toneIndex], x, y, len, w, bend);
      if (blade.tone > 0.62) {
        // Sunlit tips: a fine lighter stroke along the upper blade.
        tips.moveTo(x + Math.sin(bend * 0.6) * len * 0.55, y - len * 0.55);
        tips.lineTo(tx, ty);
      }
      if (blade.flower > 0.988)
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
      : "rgba(235, 245, 200, 0.32)";
    b.lineWidth = 0.8 * scale;
    b.stroke(tips);
    for (const fl of flowers)
      rosette(b, fl.x, fl.y, fl.r, fl.c, palette.night ? "#8a8560" : "#e9c64a");

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
