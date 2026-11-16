import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSceneAwake } from "./use-scene-awake";

let seen: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
let visibility = "visible";

function Scene() {
  const root = useRef<HTMLElement>(null);
  useSceneAwake(root);
  return <section ref={root} data-testid="scene" />;
}

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof seen) {
        seen = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const hide = (state: string) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

it("sleeps while the tab is hidden and wakes when it returns", () => {
  const scene = render(<Scene />).getByTestId("scene");
  expect(scene).not.toHaveAttribute("data-asleep");
  hide("hidden");
  expect(scene).toHaveAttribute("data-asleep");
  hide("visible");
  expect(scene).not.toHaveAttribute("data-asleep");
});

it("sleeps while the scene is off screen, and stays asleep if the tab is also hidden", () => {
  const scene = render(<Scene />).getByTestId("scene");
  seen!([{ isIntersecting: false }]);
  expect(scene).toHaveAttribute("data-asleep");
  hide("hidden");
  seen!([{ isIntersecting: true }]);
  expect(scene).toHaveAttribute("data-asleep");
  hide("visible");
  expect(scene).not.toHaveAttribute("data-asleep");
});
