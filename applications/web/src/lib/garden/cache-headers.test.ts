import { describe, expect, it } from "vitest";
import { applyPrivateCacheHeaders } from "./cache-headers";

describe("applyPrivateCacheHeaders", () => {
  it("sets and overrides the private no-store cache policy", () => {
    const response = new Response();
    response.headers.set("Cache-Control", "public, max-age=3600");

    const returned = applyPrivateCacheHeaders(response);

    expect(returned).toBe(response);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
