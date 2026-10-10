"use client";
import { useEffect, useRef } from "react";
import type { MotionValue } from "motion/react";
import type { Palette } from "@/lib/garden/scene/palette";
import { GardenAtmosphere } from "./atmosphere";

/**
 * Drives the canvas atmosphere. The back canvas sits behind the plants and the
 * front canvas in front of them. Wind is written to `--wind` on `windTarget` so
 * DOM plants lean with the same gusts.
 */
export function useAtmosphere({
  back,
  front,
  windTarget,
  palette,
  seed,
  horizon,
  fov,
  still,
  theta,
  width,
  height,
}: {
  back: React.RefObject<HTMLCanvasElement | null>;
  front: React.RefObject<HTMLCanvasElement | null>;
  windTarget: React.RefObject<HTMLElement | null>;
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
    if (!ready || !back.current || !front.current) return;
    const atmosphere = new GardenAtmosphere(back.current, front.current, {
      palette,
      seed,
      horizon,
      fov,
      still,
      getTheta: () => theta.get(),
      onWind: (wind) => windTarget.current?.style.setProperty("--wind", wind.toFixed(3)),
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
