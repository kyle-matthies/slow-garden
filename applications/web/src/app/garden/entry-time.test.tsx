import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntryTime } from "./entry-time";

describe("EntryTime", () => {
  it("renders a locale-formatted time with its source value", () => {
    const value = "2026-09-10T05:32:00.000Z";
    render(<EntryTime value={value} />);

    const time = screen.getByText(/2026/);
    const text = time.textContent ?? "";
    expect(time).toBeInTheDocument();
    expect(time).toHaveAttribute("dateTime", value);
    expect(text).not.toBe("");
    expect(text).toContain("2026");
    expect(text).toContain("Sep");
    expect(text).toMatch(/\d{1,2}:\d{2}/);
    expect(text).not.toBe(value);
  });
});
