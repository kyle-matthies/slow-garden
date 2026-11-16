import { expect, it } from "vitest";
import { draftBelongsTo } from "./delete-drafts";

const revise = { seedId: "s1", entryId: "e1", scope: "revise" as const };
const fresh = { seedId: "s1", entryId: "e9", scope: "new" as const };

it("an entry deletion discards only drafts revising that entry", () => {
  expect(draftBelongsTo(revise, { entryId: "e1" })).toBe(true);
  expect(draftBelongsTo(fresh, { entryId: "e1" })).toBe(false);
  expect(draftBelongsTo({ ...revise, entryId: "e2" }, { entryId: "e1" })).toBe(false);
});
it("a thought, topic or garden deletion discards every draft of its thoughts", () => {
  expect(draftBelongsTo(revise, { seedIds: ["s1"] })).toBe(true);
  expect(draftBelongsTo(fresh, { seedIds: ["s1", "s2"] })).toBe(true);
  expect(draftBelongsTo(fresh, { seedIds: ["s2"] })).toBe(false);
});
it("an account deletion discards everything", () => {
  expect(draftBelongsTo(fresh, { everything: true })).toBe(true);
});
