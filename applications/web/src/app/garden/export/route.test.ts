import { beforeEach, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: client }));
import { GET } from "./route";

const source = {
  exported_at: "2026-10-17T00:00:00Z",
  gardens: [], plots: [], seeds: [], entries: [], revisions: [],
};

function database(errors: Record<string, string> = {}) {
  return {
    auth: { getClaims: async () => ({ data: { claims: { sub: "synthetic" } } }) },
    rpc: async () => ({ data: source, error: null }),
    from(table: string) {
      const query = {
        select: () => query,
        order: () => query,
        range: async () => ({
          data: errors[table] ? null : [],
          error: errors[table] ? { code: errors[table] } : null,
        }),
      };
      return query;
    },
  };
}

beforeEach(() => { client.mockReset(); });

describe("export before the tending migration", () => {
  it.each(["PGRST205", "42P01"])("exports JSON and Markdown for missing tables (%s)", async (code) => {
    client.mockResolvedValue(database({ tending_marks: code, tending_mark_responses: code }));
    const json = await GET(new Request("http://localhost/garden/export"));
    expect(json.status).toBe(200);
    expect((await json.json()).derived.marks.rows).toEqual([]);
    const md = await GET(new Request("http://localhost/garden/export?format=md"));
    expect(md.status).toBe(200);
    expect(md.headers.get("Content-Type")).toContain("text/markdown");
    expect(await md.text()).toContain("No derived material.");
  });

  it.each(["42501", "57014"])("refuses a partial export on non-schema errors (%s)", async (code) => {
    client.mockResolvedValue(database({ tending_marks: code }));
    const response = await GET(new Request("http://localhost/garden/export"));
    expect(response.status).toBe(503);
  });

  it("never makes existing source or bloom tables optional", async () => {
    client.mockResolvedValue(database({ blooms: "42P01" }));
    expect((await GET(new Request("http://localhost/garden/export"))).status).toBe(503);
  });
});
