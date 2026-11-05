import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GardenData } from "@/lib/garden/types";
import { RecentWriting } from "./recent-writing";

function fixture(): GardenData {
  return {
    tenantId: "synthetic", gardenId: "g", gardens: [{ id: "g", name: "Garden", status: "active" }], aiAvailable: false,
    plots: ["p1", "p2"].map((id) => ({ id, garden_id: "g", name: id === "p1" ? "Reading" : "Work", ai_enabled: false, cross_pollinate: false, archived_at: null, permission_version: 1 })),
    seeds: ["s1", "s2"].map((id, i) => ({ id, garden_id: "g", plot_id: `p${i + 1}`, title: i ? "Another thought" : "Edited older thought", status: "active", created_at: "2026-01-01T00:00:00Z" })),
    entries: ["s1", "s2"].map((id, i) => ({ entry_id: `e${i + 1}`, revision_id: `r${i + 1}`, seed_id: id, body: "Synthetic writing is not a preview excerpt", revision_number: i ? 1 : 2, created_at: "2026-11-01T00:00:00Z", revised_at: i ? "2026-11-01T00:00:00Z" : "2026-11-04T00:00:00Z", archived_at: null })),
  };
}
afterEach(cleanup);

it("provides a collapsed native disclosure with labels, timestamps and exact saved-entry navigation", () => {
  const onNavigate = vi.fn();
  const { container } = render(<RecentWriting data={fixture()} plotId="" onNavigate={onNavigate} />);
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByText("Continue writing"));
  expect(details.open).toBe(true);
  expect(screen.getByRole("list", { name: "Recent saved thoughts" })).toBeInTheDocument();
  const first = screen.getByRole("button", { name: /Edited older thought Reading Edited/ });
  expect(first.querySelector("time")).toHaveAttribute("datetime", "2026-11-04T00:00:00.000Z");
  expect(screen.getByRole("button", { name: /Another thought Work Written/ })).toBeInTheDocument();
  expect(screen.queryByText("Synthetic writing is not a preview excerpt")).not.toBeInTheDocument();
  fireEvent.click(first);
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith("p1", "s1", "e1");
});

it("updates the displayed scope and renders no disclosure or dead CTA for empty or archived writing", () => {
  const onNavigate = vi.fn();
  const data = fixture();
  const { container, rerender } = render(<RecentWriting data={data} plotId="p2" onNavigate={onNavigate} />);
  fireEvent.click(screen.getByText("Continue writing"));
  expect(screen.getByText("Open where you last saved in this topic.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Edited older thought/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Another thought/ }));
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith("p2", "s2", "e2");
  rerender(<RecentWriting data={{ ...data, entries: [] }} onNavigate={onNavigate} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<RecentWriting data={{ ...data, gardens: [{ ...data.gardens[0], status: "archived" }] }} onNavigate={onNavigate} />);
  expect(container).toBeEmptyDOMElement();
});
