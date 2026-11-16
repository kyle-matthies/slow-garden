"use client";
import { useEffect } from "react";

/**
 * Marks the scene `data-asleep` while nobody can see it: the tab is hidden or
 * the scene has left the viewport. scene.css pauses every ambient animation
 * under that attribute. It is set on the element directly, so falling asleep
 * and waking never re-render the garden.
 */
export function useSceneAwake(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let onScreen = true;
    const apply = () => {
      const awake = onScreen && document.visibilityState === "visible";
      if (awake) element.removeAttribute("data-asleep");
      else element.setAttribute("data-asleep", "");
    };
    document.addEventListener("visibilitychange", apply);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries[entries.length - 1]?.isIntersecting ?? true;
            apply();
          });
    observer?.observe(element);
    apply();
    return () => {
      document.removeEventListener("visibilitychange", apply);
      observer?.disconnect();
      element.removeAttribute("data-asleep");
    };
  }, [root]);
}
