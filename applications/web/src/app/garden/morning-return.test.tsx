import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  EMPTY_TENDING,
  type BloomKind,
  type Tending,
  type TendingBloom,
} from "@/lib/garden/scene/tending";
import type { Plot, Seed } from "@/lib/garden/types";
import { MorningReturn } from "./morning-return";

const plots: Plot[] = [
  { id: "p1", garden_id: "g1", name: "Walking", ai_enabled: true, cross_pollinate: false, archived_at: null, permission_version: 1 },
];
const seeds: Seed[] = ["s1", "s2"].map((id, i) => ({
  id, garden_id: "g1", plot_id: "p1", title: i ? "The heron" : "The long route", status: "active", created_at: "2026-01-01T00:00:00Z",
}));
function bloom(id: string, kind: BloomKind, over: Partial<TendingBloom> = {}): TendingBloom {
  return {
    id, passId: "pass", kind, interpretation: `Synthetic ${id}`, createdAt: "2026-10-08T02:20:00Z", isNew: true,
    evidence: [
      { revisionId: `${id}-r1`, seedId: "s1", excerpt: "Synthetic one", writtenAt: "2026-03-01T00:00:00Z" },
      { revisionId: `${id}-r2`, seedId: "s2", excerpt: "Synthetic two", writtenAt: "2026-09-01T00:00:00Z" },
    ],
    ...over,
  };
}
const tending = (blooms: TendingBloom[]): Tending => ({ marks: [], themes: [], blooms });
function show(t: Tending) {
  const onOpenThought = vi.fn(), onOpenReturns = vi.fn();
  const view = render(
    <MorningReturn tending={t} seeds={seeds} plots={plots} onOpenThought={onOpenThought} onOpenReturns={onOpenReturns} />,
  );
  return { ...view, onOpenThought, onOpenReturns };
}

afterEach(() => { cleanup(); window.localStorage.clear(); });

it("renders nothing at all when there is nothing unseen", () => {
  expect(show(EMPTY_TENDING).container).toBeEmptyDOMElement();
  cleanup();
  const seen = tending([
    bloom("a", "connection", { isNew: false }),
    bloom("b", "tension", { response: "prune" }),
  ]);
  expect(show(seen).container).toBeEmptyDOMElement();
});

it("shows at most three unseen blooms, each labelled by kind and marked AI-derived", () => {
  show(tending([
    bloom("a", "connection"), bloom("b", "echo"), bloom("c", "question"), bloom("d", "change"),
  ]));
  expect(screen.getByRole("heading", { name: "Overnight, the garden noticed…" })).toBeInTheDocument();
  expect(screen.getByText("The garden noticed · AI-derived")).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByText("Possible connection")).toBeInTheDocument();
  expect(screen.getByText("Echo · 6 months apart")).toBeInTheDocument();
  expect(screen.getByText("Synthetic c")).toBeInTheDocument();
  expect(screen.queryByText("Synthetic d")).not.toBeInTheDocument();
  expect(screen.getByText("1 more in Returns")).toBeInTheDocument();
});

it("dismiss marks every unseen bloom seen, and it stays gone on reopening", () => {
  const blooms = tending([bloom("a", "connection"), bloom("b", "tension")]);
  const first = show(blooms);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss and mark as seen" }));
  expect(first.container).toBeEmptyDOMElement();
  expect(first.onOpenReturns).not.toHaveBeenCalled();
  cleanup();
  expect(show(blooms).container).toBeEmptyDOMElement();
});

it("opens the touched thought and Returns through its callbacks", () => {
  const view = show(tending([bloom("a", "connection")]));
  fireEvent.click(screen.getByRole("button", { name: "The heron in Walking" }));
  expect(view.onOpenThought).toHaveBeenCalledExactlyOnceWith("s2");
  expect(view.onOpenReturns).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open Returns" }));
  expect(view.onOpenReturns).toHaveBeenCalledOnce();
});
