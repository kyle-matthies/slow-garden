import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_TENDING, type Tending } from "@/lib/garden/scene/tending";
import { ReturnsPage } from "./level-returns";

afterEach(cleanup);

const TENDED = "2026-11-03T02:05:00.000Z";
const bloom = {
  id: "bloom-1",
  kind: "change",
  interpretation: "synthetic interpretation",
  evidence: [],
  createdAt: TENDED,
  isNew: false,
} as unknown as Tending["blooms"][number];

function page(tending: Tending, tendingActive: boolean) {
  render(
    <ReturnsPage tending={tending} seeds={[]} tendingActive={tendingActive} onOpenThought={() => {}} onSeen={() => {}}>
      <p>record</p>
    </ReturnsPage>,
  );
  return document.querySelector(".returns-page")!.textContent ?? "";
}

const NOT_NOW =
  "Tending is not active now. What was returned before stays here to read, and nothing new will arrive until tending is active.";

describe("what Returns says about tending", () => {
  it("never tended and inactive: nothing was returned and no AI has read anything", () => {
    const text = page(EMPTY_TENDING, false);
    expect(text).toContain(
      "Nothing has been returned. Tending is not active for this account yet, so no AI has read your writing.",
    );
    expect(text).not.toContain("Last tended");
    expect(text).not.toContain(NOT_NOW);
  });

  it("tended before, inactive now, no bloom showing: says one true thing and never that no AI has read the writing", () => {
    const text = page({ ...EMPTY_TENDING, lastTendedAt: TENDED }, false);
    expect(text).toContain("Last tended");
    expect(screen.getByText(NOT_NOW)).toBeInTheDocument();
    expect(text).not.toContain("no AI has read");
    expect(text).not.toContain("Nothing has been returned");
    expect(screen.getByText("No bloom is showing. Earlier tending passes are in the full record below.")).toBeInTheDocument();
  });

  it("tended before, inactive now, blooms showing: the blooms stay readable beside the same sentence", () => {
    page({ ...EMPTY_TENDING, blooms: [bloom], lastTendedAt: TENDED }, false);
    expect(screen.getByText("synthetic interpretation")).toBeInTheDocument();
    expect(screen.getByText(NOT_NOW)).toBeInTheDocument();
  });

  it("active: no word about tending being inactive", () => {
    const text = page({ ...EMPTY_TENDING, lastTendedAt: TENDED }, true);
    expect(text).toContain("Last tended");
    expect(text).not.toContain("not active");
    expect(text).toContain("Nothing has been returned yet.");
  });
});
