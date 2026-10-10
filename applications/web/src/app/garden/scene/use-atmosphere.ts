"use client";
import { useEffect, useRef } from "react";
import type { MotionValue } from "motion/react";
import type { Palette } from "@/lib/garden/scene/palette";
import { GardenAtmosphere } from "./atmosphere";

/**
 * Drives the canvas atmosphere. The far and back canvases sit behind the plants
 * and the front canvas in front of them. DOM plants sway with a compositor-only
 * CSS gust (scene.css), so the loop never writes styles per frame.
 */
export function useAtmosphere({
  far,
  back,
  front,
  palette,
  seed,
  horizon,
  fov,
  still,
  theta,
  width,
  height,
}: {
  far: React.RefObject<HTMLCanvasElement | null>;
  back: React.RefObject<HTMLCanvasElement | null>;
  front: React.RefObject<HTMLCanvasElement | null>;
  palette: Palette;
  seed: number;
  horizon: number;
  fov: number;
  still: boolean;
  theta: MotionValue<number>;
  width: number;
  height: number;
}) {
  const engine = useRef<GardenAtmosphere | null>(null);
  const ready = width > 0 && height > 0;

  useEffect(() => {
    if (!ready || !far.current || !back.current || !front.current) return;
    const atmosphere = new GardenAtmosphere(far.current, back.current, front.current, {
      palette,
      seed,
      horizon,
      fov,
      still,
      getTheta: () => theta.get(),
    });
    engine.current = atmosphere;
    atmosphere.resize(width, height);
    const unsubscribe = theta.on("change", () => atmosphere.redraw());
    return () => {
      unsubscribe();
      atmosphere.destroy();
      engine.current = null;
    };
    // Created once when the scene has a size; later changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    engine.current?.update({ palette, seed, horizon, fov, still });
  }, [palette, seed, horizon, fov, still]);

  useEffect(() => {
    engine.current?.resize(width, height);
  }, [width, height]);
}
