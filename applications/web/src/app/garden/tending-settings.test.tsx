import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TendingSettings } from "./tending-settings";
import { TendingActivity } from "./tending-activity";
import { EMPTY_TENDING } from "@/lib/garden/scene/tending";
const save = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ setTendingPreferences: save }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("saves permission without claiming that an overnight service started", async () => {
  save.mockResolvedValue({ ok: true });
  const onSaved = vi.fn();
  render(<TendingSettings account={{ tendOvernight: false, timezone: "UTC" }} aiAvailable={false} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(screen.getByRole("status")).toHaveTextContent("does not start or confirm an overnight run");
  expect(screen.getByText(/Earlier manual results/)).toBeVisible();
});

it("restores the saved checkbox and time zone after a rejected update", async () => {
  save.mockResolvedValue({ ok: false, message: "Please retry." });
  render(<TendingSettings account={{ tendOvernight: true, timezone: "US/Pacific" }} aiAvailable onSaved={vi.fn()} />);
  expect(screen.getByRole("combobox")).toHaveValue("US/Pacific");
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Please retry."));
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "UTC" } });
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("US/Pacific"));
});

it("retains saved permission after a network failure", async () => {
  save.mockRejectedValue(Error("offline"));
  render(<TendingSettings account={{ tendOvernight: false, timezone: "UTC" }} aiAvailable onSaved={vi.fn()} />);
  await act(async () => fireEvent.click(screen.getByRole("checkbox")));
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("status")).toHaveTextContent("Could not save");
});

it("explains completed catalogue-only passes and does not treat them as scheduled delivery", () => {
  render(<TendingActivity history={{ available: true, passes: [{ id: "p", status: "complete", createdAt: "2026-11-02T10:00:00Z", finishedAt: null }] }} tending={EMPTY_TENDING} />);
  expect(screen.getByText("Completed")).toBeVisible();
  expect(screen.getByText(/manual pass does not confirm an overnight schedule/)).toBeVisible();
  expect(screen.getByText(/completed pass can return no new reflection/)).toBeVisible();
});

it("does not mistake unavailable history for no passes", () => {
  const { rerender } = render(<TendingActivity history={{ available: false, passes: [] }} />);
  expect(screen.getByRole("status")).toHaveTextContent("temporarily unavailable");
  expect(screen.queryByText(/No tending passes/)).not.toBeInTheDocument();
  rerender(<TendingActivity history={{ available: true, passes: [] }} />);
  expect(screen.getByText(/No tending passes/)).toBeVisible();
});
