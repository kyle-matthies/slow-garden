import { describe, expect, it, vi } from "vitest";
import { loadTendingHistory } from "./tending-history";

function fake(result: unknown, reject = false) {
  const builder: Record<string, unknown> = {};
  const select = vi.fn(() => builder), eq = vi.fn(() => builder), limit = vi.fn(() => builder);
  builder.select = select; builder.eq = eq; builder.limit = limit;
  builder.order = () => builder;
  builder.then = (resolve: (value: unknown) => unknown, onReject: (reason: unknown) => unknown) =>
    (reject ? Promise.reject(Error("offline")) : Promise.resolve(result)).then(resolve, onReject);
  return { db: { from: () => builder } as never, select, eq, limit };
}

describe("loadTendingHistory", () => {
  it("bounds a garden-scoped RLS read to operational fields and maps a completed pass", async () => {
    const f = fake({ data: [{ id: "p1", status: "complete", created_at: "2026-11-02T10:00:00Z", finished_at: "2026-11-02T10:01:00Z" }], error: null });
    expect(await loadTendingHistory(f.db, "g1")).toEqual({ available: true, passes: [{ id: "p1", status: "complete", createdAt: "2026-11-02T10:00:00Z", finishedAt: "2026-11-02T10:01:00Z" }] });
    expect(f.select).toHaveBeenCalledWith("id,status,created_at,finished_at");
    expect(f.eq).toHaveBeenCalledWith("garden_id", "g1");
    expect(f.limit).toHaveBeenCalledWith(5);
  });
  it("distinguishes a successful empty history from unavailable history", async () => {
    expect(await loadTendingHistory(fake({ data: [], error: null }).db, "g1")).toEqual({ available: true, passes: [] });
    for (const f of [fake({ data: null, error: Error("denied") }), fake(null, true), fake({ data: [{ status: "unexpected", created_at: "bad" }], error: null })]) {
      expect(await loadTendingHistory(f.db, "g1")).toEqual({ available: false, passes: [] });
    }
  });
});
