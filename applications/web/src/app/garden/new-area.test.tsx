import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NewArea } from "./new-area";

vi.mock("./actions", () => ({ createArea: vi.fn() }));
afterEach(cleanup);

it("waits behind its button by default and opens straight to the name field when asked", () => {
  render(<NewArea kind="garden" parentId="" onCreated={() => {}} />);
  expect(screen.getByRole("button", { name: "＋ New garden" })).toBeVisible();
  expect(screen.queryByLabelText("Name your garden")).toBeNull();
  cleanup();
  render(<NewArea kind="garden" parentId="" onCreated={() => {}} startOpen />);
  const name = screen.getByLabelText("Name your garden");
  expect(name).toHaveFocus();
  // Native keyboard hints only: nothing suggests or completes the name.
  expect(name).toHaveAttribute("autocomplete", "off");
  expect(name).toHaveAttribute("enterkeyhint", "done");
});
