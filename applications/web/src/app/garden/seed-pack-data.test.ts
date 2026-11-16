import { describe, expect, it } from "vitest";
import { parseOnboardingDraft, emptyOnboardingDraft } from "@/lib/garden/onboarding-draft";
import { SEED_PACKS, bedKeyFor, seedTopicFor } from "./seed-pack-data";

const topics = SEED_PACKS.flatMap((pack) => pack.topics);
const copy = SEED_PACKS.flatMap((pack) => [pack.name, pack.note, ...pack.topics.flatMap((t) => [t.name, t.question])]);

describe("seed packs", () => {
  it("offers six to eight packs of three or four topics, each with one question", () => {
    expect(SEED_PACKS.length).toBeGreaterThanOrEqual(6);
    expect(SEED_PACKS.length).toBeLessThanOrEqual(8);
    for (const pack of SEED_PACKS) {
      expect(pack.topics.length).toBeGreaterThanOrEqual(3);
      expect(pack.topics.length).toBeLessThanOrEqual(4);
      for (const topic of pack.topics) expect(topic.question.trim().endsWith("?")).toBe(true);
    }
  });

  it("uses names the existing actions accept, with no duplicates and none that collide with Notes", () => {
    for (const topic of topics) {
      expect(topic.name.trim().length).toBeGreaterThan(0);
      expect(topic.name.length).toBeLessThanOrEqual(120);
      expect(topic.question.length).toBeLessThanOrEqual(160);
    }
    const names = topics.map((t) => t.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("notes");
    expect(new Set(SEED_PACKS.map((p) => p.id)).size).toBe(SEED_PACKS.length);
    expect(new Set(SEED_PACKS.map((p) => p.plant)).size).toBe(SEED_PACKS.length);
  });

  it("stays plain: no clinical or mood language, no advice, no promised outcomes", () => {
    const banned = /\b(mood|feel(ing|ings)?|emotion\w*|anxi\w*|stress\w*|depress\w*|trauma\w*|heal\w*|therap\w*|mental|wellness|wellbeing|self-care|mindful\w*|gratitude|grateful|cope|coping|trigger\w*|journey|unlock|transform\w*|improve\w*|better|clarity|productiv\w*|goals?|habit\w*|should|must|will help|insight\w*|AI)\b/i;
    for (const line of copy) expect(line, line).not.toMatch(banned);
  });

  it("makes bed keys the draft parser accepts and can look them up again", () => {
    const beds = SEED_PACKS.flatMap((pack) => pack.topics.map((topic, index) => ({
      key: bedKeyFor(pack.id, index), name: topic.name, on: true, requestId: "", id: "",
    })));
    const draft = { ...emptyOnboardingDraft(), packs: SEED_PACKS.map((p) => p.id), beds, writeIn: beds[2].key };
    expect(parseOnboardingDraft(JSON.stringify(draft))?.beds).toHaveLength(topics.length);
    expect(seedTopicFor(beds[2].key)?.topic.name).toBe(beds[2].name);
    expect(seedTopicFor("gone/0")).toBeNull();
  });
});
