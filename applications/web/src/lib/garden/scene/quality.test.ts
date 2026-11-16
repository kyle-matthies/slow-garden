import { describe, expect, it } from "vitest";
import {
  FULL,
  FLOOR,
  atFloor,
  judge,
  recall,
  remember,
  settle,
  stepDown,
  stepUp,
  QUALITY_KEY,
} from "./quality";

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
};

describe("judging a window of frames", () => {
  it("is slow when drawing or frame pacing is over budget, far over when badly so, fast only with headroom", () => {
    expect(judge(2, 16.7)).toBe("fast");
    expect(judge(5, 16.7)).toBe("fine");
    expect(judge(2, 20)).toBe("fine");
    expect(judge(9, 16.7)).toBe("slow");
    expect(judge(2, 25)).toBe("slow");
    // Half the display rate or worse, or drawing alone taking a whole frame.
    expect(judge(2, 33.4)).toBe("far-over");
    expect(judge(17, 16.7)).toBe("far-over");
  });
});

describe("the quality ladder", () => {
  it("thins the grass first and only then softens the canvas, down to a floor", () => {
    let level = FULL;
    const seen = [level];
    for (let i = 0; i < 12; i++) seen.push((level = stepDown(level)));
    expect(seen[1]).toEqual({ quality: 0.7, resolution: 1 });
    expect(seen.find((l) => l.resolution < 1)!.quality).toBe(FLOOR.quality);
    expect(level).toEqual(FLOOR);
    expect(atFloor(level)).toBe(true);
    expect(stepDown(FLOOR)).toBe(FLOOR);
  });

  it("restores resolution first, then grass, up to full", () => {
    let level = FLOOR;
    level = stepUp(level);
    expect(level.resolution).toBeGreaterThan(FLOOR.resolution);
    expect(level.quality).toBe(FLOOR.quality);
    for (let i = 0; i < 20; i++) level = stepUp(level);
    expect(level).toEqual(FULL);
    expect(stepUp(FULL)).toBe(FULL);
  });
});

describe("settling before the first touch", () => {
  it("keeps full quality when the first window is fine, and stops", () => {
    expect(settle(FULL, "fine", 5)).toEqual({ level: FULL, windowsLeft: 0 });
    expect(settle(FULL, "fast", 5)).toEqual({ level: FULL, windowsLeft: 0 });
  });

  it("steps once when slow and twice when far over, and keeps looking", () => {
    expect(settle(FULL, "slow", 5)).toEqual({ level: stepDown(FULL), windowsLeft: 4 });
    expect(settle(FULL, "far-over", 5)).toEqual({ level: stepDown(stepDown(FULL)), windowsLeft: 4 });
  });

  it("reaches the floor within four windows on a device that never keeps pace, then stops", () => {
    let state = { level: FULL, windowsLeft: 6 };
    let windows = 0;
    while (state.windowsLeft > 0) {
      state = settle(state.level, "far-over", state.windowsLeft);
      windows++;
    }
    expect(state.level).toEqual(FLOOR);
    expect(windows).toBeLessThanOrEqual(4);
  });

  it("never runs past its allowance, and never raises quality", () => {
    expect(settle(stepDown(FULL), "slow", 1).windowsLeft).toBe(0);
    expect(settle(stepDown(FULL), "fast", 3).level).toEqual(stepDown(FULL));
  });
});

describe("remembering what this device settled on", () => {
  const area = 1280 * 800;
  it("starts a later visit where the last one settled, for a screen of about the same size", () => {
    const storage = memory();
    remember(storage, FLOOR, area);
    expect(recall(storage, area)).toEqual(FLOOR);
    expect(recall(storage, area * 1.1)).toEqual(FLOOR);
    expect(storage.items.has(QUALITY_KEY)).toBe(true);
  });

  it("forgets it for a very different screen, and with nothing stored", () => {
    const storage = memory();
    expect(recall(storage, area)).toBeNull();
    remember(storage, FLOOR, area);
    expect(recall(storage, 390 * 844 * 4)).toBeNull();
  });

  it("ignores anything malformed or out of range, and storage that throws", () => {
    const storage = memory();
    for (const bad of ["", "{", "null", '{"q":2,"r":1,"a":1024000}', '{"q":0.5,"r":0.1,"a":1024000}', '{"q":"x","r":1,"a":1024000}']) {
      storage.items.set(QUALITY_KEY, bad);
      expect(recall(storage, area), bad).toBeNull();
    }
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(recall(broken, area)).toBeNull();
    expect(() => remember(broken, FLOOR, area)).not.toThrow();
    expect(recall(undefined, area)).toBeNull();
    expect(() => remember(undefined, FLOOR, area)).not.toThrow();
  });
});
