/**
 * The viewer stands in the middle of a circular garden. Beds sit on the ring
 * around them; rotating the camera passes from bed to bed. Angles are degrees.
 */
export const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
export const mod360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Evenly spaced bed angles; the first bed faces the viewer. */
export function bedAngles(count: number): number[] {
  if (count <= 0) return [];
  const spacing = 360 / count;
  return Array.from({ length: count }, (_, i) => i * spacing);
}

/** Angular width a bed may occupy without crowding its neighbours. */
export function bedWidth(count: number, fov: number): number {
  if (count <= 1) return Math.min(fov * 0.9, 110);
  return Math.max(26, Math.min(360 / count - 8, fov * 0.85, 96));
}

/** Field of view in degrees: wider on desktop so neighbouring beds show. */
export function fieldOfView(width: number, height: number): number {
  const aspect = width / Math.max(1, height);
  if (aspect < 0.8) return 58;
  if (aspect < 1.3) return 72;
  return 88;
}

export function pixelsPerDegree(width: number, fov: number) {
  return width / fov;
}

/** Closest equivalent of target to current, so rotation takes the short way. */
export function nearestAngle(current: number, target: number) {
  return current + wrap(target - current);
}

export function nearestBed(theta: number, angles: readonly number[]): number {
  let best = 0;
  let bestDistance = Infinity;
  angles.forEach((angle, i) => {
    const d = Math.abs(wrap(angle - theta));
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}

/*
 * Ground depth model shared by the grass canvas and the DOM plants, so that a
 * plant and the grass at its base move together when the camera turns.
 * Heights are fractions of the ground (horizon to bottom edge).
 */
/** Grass at depth d (0 horizon .. 1 viewer) sits this far down the ground. */
export const grassY = (d: number) => 0.015 + 0.985 * Math.pow(d, 1.35);
/** Far grass travels less than near grass when the camera turns. */
export const grassParallax = (d: number) => 0.32 + 0.88 * d;
/** A plant at bed depth p (0 back .. 1 front) has its base this far down. */
export const plantY = (p: number) => 0.1 + 0.78 * p;
/** Parallax for a plant: the same as the grass at its base. */
export const rowParallax = (p: number) =>
  grassParallax(Math.pow(Math.max(0, (plantY(p) - 0.015) / 0.985), 1 / 1.35));

export function isVisible(
  angle: number,
  theta: number,
  fov: number,
  halfWidth: number,
  factor = 1,
) {
  return Math.abs(wrap(angle - theta * factor)) <= fov / 2 + halfWidth + 4;
}
