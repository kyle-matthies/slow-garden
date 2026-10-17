import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSeenTending } from "./use-seen-tending";
import type { Tending } from "./scene/tending";

const source: Tending = {
  marks: [], themes: [], blooms: [{
    id: "bloom-a", passId: "pass-a", kind: "connection", interpretation: "Synthetic",
    evidence: [], createdAt: "2026-01-01T00:00:00Z", isNew: true,
  }],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

it("clears New after viewing, survives reopening, and isolates accounts", () => {
  const first = renderHook(() => useSeenTending("author-a", source));
  expect(first.result.current.tending.blooms[0].isNew).toBe(true);
  act(() => first.result.current.markBloomsSeen(["bloom-a"]));
  expect(first.result.current.tending.blooms[0].isNew).toBe(false);
  first.unmount();
  const reopened = renderHook(() => useSeenTending("author-a", source));
  expect(reopened.result.current.tending.blooms[0].isNew).toBe(false);
  const another = renderHook(() => useSeenTending("author-b", source));
  expect(another.result.current.tending.blooms[0].isNew).toBe(true);
  expect(source.blooms[0].isNew).toBe(true);
});

it("still remembers a view for this session when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const { result } = renderHook(() => useSeenTending("restricted-browser", source));
  act(() => result.current.markBloomsSeen(["bloom-a"]));
  expect(result.current.tending.blooms[0].isNew).toBe(false);
});
