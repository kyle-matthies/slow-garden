// Run with: node --test src/lib/garden/search.test.mjs  (Node 22+, type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  excerpt,
  groupEntriesByDay,
  searchGarden,
  timelineEntries,
  tokenize,
} from "./search.ts";

// Synthetic fixtures only. Nothing here comes from a real journal.
const plots = [
  {
    id: "p1",
    garden_id: "g",
    name: "Walking",
    ai_enabled: false,
    cross_pollinate: false,
    archived_at: null,
    permission_version: 1,
  },
  {
    id: "p2",
    garden_id: "g",
    name: "Old topic",
    ai_enabled: false,
    cross_pollinate: false,
    archived_at: "2026-01-01T00:00:00Z",
    permission_version: 1,
  },
];
const seeds = [
  {
    id: "s1",
    garden_id: "g",
    plot_id: "p1",
    title: "Morning light on the river",
    status: "active",
    created_at: "2026-08-01T08:00:00Z",
  },
  {
    id: "s2",
    garden_id: "g",
    plot_id: "p1",
    title: "Unfinished questions",
    status: "active",
    created_at: "2026-08-02T08:00:00Z",
  },
  {
    id: "s3",
    garden_id: "g",
    plot_id: "p1",
    title: "River, archived thought",
    status: "archived",
    created_at: "2026-07-01T08:00:00Z",
  },
  {
    id: "s4",
    garden_id: "g",
    plot_id: "p2",
    title: "River in an archived topic",
    status: "active",
    created_at: "2026-06-01T08:00:00Z",
  },
];
const entry = (id, seed_id, body, created_at, archived_at = null) => ({
  entry_id: id,
  revision_id: `${id}-r1`,
  seed_id,
  body,
  revision_number: 1,
  created_at,
  revised_at: created_at,
  archived_at,
});
const entries = [
  entry(
    "e1",
    "s1",
    "Walked before sunrise. The river was quiet and the light came slowly.",
    "2026-09-01T06:10:00Z",
  ),
  entry(
    "e2",
    "s2",
    "Why does the river keep coming back into my notes? Maybe the light.",
    "2026-09-01T21:40:00Z",
  ),
  entry(
    "e3",
    "s2",
    "A shorter note with nothing relevant.",
    "2026-09-03T12:00:00Z",
  ),
  entry(
    "e4",
    "s2",
    "Archived: the river again, but I set this aside.",
    "2026-09-02T12:00:00Z",
    "2026-09-04T00:00:00Z",
  ),
  entry(
    "e5",
    "s3",
    "Body inside an archived thought mentioning the river.",
    "2026-07-02T12:00:00Z",
  ),
  entry(
    "e6",
    "s4",
    "Body inside an archived topic mentioning the river.",
    "2026-06-02T12:00:00Z",
  ),
];
const scope = { seeds, entries, plots };

test("tokenize lowercases, strips accents and punctuation, dedupes", () => {
  assert.deepEqual(tokenize("  Café, café! RIVER "), ["cafe", "river"]);
  assert.deepEqual(tokenize("..."), []);
});

test("single-character queries return nothing", () => {
  assert.deepEqual(searchGarden("r", scope), []);
  assert.deepEqual(searchGarden("   ", scope), []);
});

test("title matches outrank body matches, then recency decides", () => {
  const hits = searchGarden("river", scope);
  assert.equal(hits[0].kind, "title");
  assert.equal(hits[0].seed.id, "s1");
  const rest = hits.slice(1);
  assert.ok(rest.every((h) => h.kind === "entry"));
  assert.deepEqual(
    rest.map((h) => h.entry.entry_id),
    ["e2", "e1"],
    "body hits are newest first",
  );
});

test("archived thoughts, topics, and entries are excluded unless requested", () => {
  const active = searchGarden("river", scope);
  assert.ok(active.every((h) => !h.archived));
  assert.ok(!active.some((h) => h.entry?.entry_id === "e4"));
  const all = searchGarden("river", { ...scope, includeArchived: true });
  const ids = all.map((h) => h.entry?.entry_id ?? `title:${h.seed.id}`);
  assert.ok(ids.includes("e4"), "archived entry");
  assert.ok(ids.includes("e5"), "entry in archived thought");
  assert.ok(ids.includes("e6"), "entry in archived topic");
  assert.ok(ids.includes("title:s3") && ids.includes("title:s4"));
  assert.ok(all.filter((h) => h.archived).length >= 5);
});

test("a garden archived as a whole marks every hit archived", () => {
  const none = searchGarden("river", { ...scope, gardenArchived: true });
  assert.deepEqual(none, []);
  const all = searchGarden("river", {
    ...scope,
    gardenArchived: true,
    includeArchived: true,
  });
  assert.ok(all.length > 0 && all.every((h) => h.archived));
});

test("every term must match; an intact phrase ranks above scattered terms", () => {
  const hits = searchGarden("river light", scope);
  assert.ok(hits.length >= 2);
  assert.equal(hits[0].kind, "title", "title contains both terms");
  const bodies = hits
    .filter((h) => h.kind === "entry")
    .map((h) => h.entry.entry_id);
  assert.deepEqual(
    bodies,
    ["e2", "e1"],
    "both bodies contain both terms; newest first",
  );
  assert.deepEqual(
    searchGarden("river zebra", scope),
    [],
    "a missing term excludes the item",
  );
  const phrase = searchGarden("quiet and the light", scope);
  assert.equal(phrase[0].entry.entry_id, "e1");
});

test("scope can be limited to one topic and the result count is bounded", () => {
  const topic = searchGarden("river", {
    ...scope,
    plotId: "p2",
    includeArchived: true,
  });
  assert.ok(topic.length > 0 && topic.every((h) => h.seed.plot_id === "p2"));
  assert.equal(searchGarden("river", { ...scope, limit: 1 }).length, 1);
});

test("excerpt highlights every term inside a bounded window with ellipses", () => {
  const long = `${"before ".repeat(40)}the RIVER carried the light ${"after ".repeat(40)}`;
  const segments = excerpt(long, ["river", "light"], 30);
  const text = segments.map((s) => s.text).join("");
  assert.ok(text.startsWith("…") && text.endsWith("…"));
  assert.ok(text.length < 120, `window is bounded: ${text.length}`);
  assert.deepEqual(
    segments.filter((s) => s.highlight).map((s) => s.text),
    ["RIVER", "light"],
    "highlights preserve original casing",
  );
  assert.ok(
    long.includes(text.replace(/…/g, "")),
    "excerpt is a verbatim slice",
  );
});

test("excerpt without a match falls back to a bounded prefix", () => {
  const segments = excerpt("x".repeat(500), ["nothing"], 10);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, `${"x".repeat(20)}…`);
  assert.equal(segments[0].highlight, false);
});

test("excerpt matches accented text against plain terms", () => {
  const segments = excerpt("Un café tranquille", ["cafe"]);
  assert.deepEqual(
    segments.filter((s) => s.highlight).map((s) => s.text),
    ["café"],
  );
});

test("excerpt collapses whitespace and handles overlapping terms", () => {
  const segments = excerpt("river\n\n  riverbank", ["river", "riverbank"]);
  assert.equal(segments.map((s) => s.text).join(""), "river riverbank");
  assert.deepEqual(
    segments.filter((s) => s.highlight).map((s) => s.text),
    ["river", "riverbank"],
  );
});

test("timeline groups entries by calendar day in the given time zone", () => {
  const visible = timelineEntries(scope);
  assert.deepEqual(visible.map((e) => e.entry_id).sort(), ["e1", "e2", "e3"]);
  const utc = groupEntriesByDay(visible, "UTC");
  assert.deepEqual(
    utc.map((g) => g.day),
    ["2026-09-03", "2026-09-01"],
  );
  assert.deepEqual(
    utc[1].entries.map((e) => e.entry_id),
    ["e2", "e1"],
    "newest entry first within a day",
  );
  const tokyo = groupEntriesByDay(visible, "Asia/Tokyo");
  assert.deepEqual(
    tokyo.map((g) => g.day),
    ["2026-09-03", "2026-09-02", "2026-09-01"],
    "late-evening UTC entry rolls into the next local day",
  );
});

test("timeline respects topic scope and the archived toggle", () => {
  assert.deepEqual(
    timelineEntries({ ...scope, plotId: "p2" }),
    [],
    "archived topic hidden by default",
  );
  assert.deepEqual(
    timelineEntries({ ...scope, plotId: "p2", includeArchived: true }).map(
      (e) => e.entry_id,
    ),
    ["e6"],
  );
  assert.equal(
    timelineEntries({ ...scope, includeArchived: true }).length,
    entries.length,
  );
});
