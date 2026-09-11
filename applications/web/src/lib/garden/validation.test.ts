import { describe, expect, it } from "vitest";
import {
  saveErrorMessage,
  validateAreaName,
  validateBloomResponse,
  validateEntryBody,
} from "./validation";

describe("validateAreaName", () => {
  it("enforces trimmed names and kind-specific limits", () => {
    expect(validateAreaName("garden", "   ")).toBe(
      "Please choose a short name.",
    );
    expect(validateAreaName("plot", "p".repeat(120))).toBeNull();
    expect(validateAreaName("plot", "p".repeat(121))).toBe(
      "Please choose a short name.",
    );
    expect(validateAreaName("seed", "s".repeat(160))).toBeNull();
    expect(validateAreaName("seed", "s".repeat(161))).toBe(
      "Please choose a short name.",
    );
  });
});

describe("validateEntryBody", () => {
  it("enforces non-empty writing and the maximum body length", () => {
    expect(validateEntryBody("")).toBe(
      "Write between 1 and 20,000 characters.",
    );
    expect(validateEntryBody(" \n\t ")).toBe(
      "Write between 1 and 20,000 characters.",
    );
    expect(validateEntryBody("b".repeat(20000))).toBeNull();
    expect(validateEntryBody("b".repeat(20001))).toBe(
      "Write between 1 and 20,000 characters.",
    );
  });
});

describe("validateBloomResponse", () => {
  it("requires corrections only for corrected blooms", () => {
    expect(validateBloomResponse("correct", "  ")).toBe(
      "Add your correction in your own words.",
    );
    expect(validateBloomResponse("correct", "My correction")).toBeNull();
    expect(validateBloomResponse("prune", "")).toBeNull();
  });
});

describe("saveErrorMessage", () => {
  it("returns conflict and generic save messages", () => {
    expect(saveErrorMessage({ code: "40001" })).toBe(
      "This entry changed elsewhere. Reload to review it; your draft is still here.",
    );
    expect(saveErrorMessage(new Error("x"))).toBe(
      "Could not save. Your writing is still here; please retry.",
    );
    expect(saveErrorMessage(undefined)).toBe(
      "Could not save. Your writing is still here; please retry.",
    );
  });
});
