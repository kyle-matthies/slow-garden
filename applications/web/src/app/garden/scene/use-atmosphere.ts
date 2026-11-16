"use client";
import { useEffect, useRef } from "react";
import type { MotionValue } from "motion/react";
import type { Palette } from "@/lib/garden/scene/palette";
import { GardenAtmosphere } from "./atmosphere";

/**
 * Paints the canvas atmosphere. The far and back canvases sit behind the plants
 * and the front canvas in front of them. It draws once and then only while the
 * camera moves; everything that moves at rest is compositor-only CSS (scene.css).
 */
export function useAtmosphere({
  far,
  back,
  front,
  palette,
  seed,
  horizon,
  fov,
  theta,
  width,
  height,
  zoom,
  thetaScale = 1,
}: {
  far: React.RefObject<HTMLCanvasElement | null>;
  back: React.RefObject<HTMLCanvasElement | null>;
  front: React.RefObject<HTMLCanvasElement | null>;
  palette: Palette;
  seed: number;
  horizon: number;
  fov: number;
  theta: MotionValue<number>;
  width: number;
  height: number;
  /** Camera closeness; the ground scales with it. */
  zoom?: MotionValue<number>;
  /** Grass degrees per camera degree, so grass and beds travel together. */
  thetaScale?: number;
}) {
  const engine = useRef<GardenAtmosphere | null>(null);
  const scale = useRef(thetaScale);
  useEffect(() => {
    scale.current = thetaScale;
    engine.current?.update({});
  }, [thetaScale]);
  const ready = width > 0 && height > 0;

  useEffect(() => {
    if (!ready || !far.current || !back.current || !front.current) return;
    const atmosphere = new GardenAtmosphere(far.current, back.current, front.current, {
      palette,
      seed,
      horizon,
      fov,
      getTheta: () => theta.get() * scale.current,
      getZoom: () => zoom?.get() ?? 1,
    });
    engine.current = atmosphere;
    atmosphere.resize(width, height);
    const unsubscribe = theta.on("change", () => atmosphere.redraw());
    const unsubscribeZoom = zoom?.on("change", () => atmosphere.redraw());
    return () => {
      unsubscribe();
      unsubscribeZoom?.();
      atmosphere.destroy();
      engine.current = null;
    };
    // Created once when the scene has a size; later changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    engine.current?.update({ palette, seed, horizon, fov });
  }, [palette, seed, horizon, fov]);

  useEffect(() => {
    engine.current?.resize(width, height);
  }, [width, height]);
}
