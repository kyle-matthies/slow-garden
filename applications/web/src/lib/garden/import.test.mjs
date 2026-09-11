import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IMPORT_LIMITS,
  deterministicId,
  parseDateHeading,
  parseImportFile,
  sha256Hex,
} from "./import.ts";

test("title comes from a leading level-1 heading", async () => {
  const t = await parseImportFile({
    name: "whatever.txt",
    text: "# My thought ##\n\nSome body text.",
  });
  assert.equal(t.title, "My thought");
  assert.equal(t.entries.length, 1);
  assert.equal(t.entries[0].body, "Some body text.");
});

test("title falls back to the file name", async () => {
  const t = await parseImportFile({
    name: "morning-notes_march.md",
    text: "Just text, no heading.",
  });
  assert.equal(t.title, "morning notes march");
});

test("dated headings in every accepted format split entries", async () => {
  const formats = [
    ["2024-03-05", "2024-03-05"],
    ["2024/03/05", "2024-03-05"],
    ["2024-03-05 Tuesday", "2024-03-05"],
    ["March 5, 2024", "2024-03-05"],
    ["5 March 2024", "2024-03-05"],
    ["Mar 5 2024", "2024-03-05"],
    ["2024-03-05 - reflections", "2024-03-05"],
    ["March 5, 2024 · later", "2024-03-05"],
  ];
  for (const [heading, date] of formats) {
    const t = await parseImportFile({
      name: "x.md",
      text: `## ${heading}\nbody for ${heading}`,
    });
    assert.equal(t.entries.length, 1, heading);
    assert.equal(t.entries[0].date, date, heading);
    assert.equal(t.entries[0].body, `body for ${heading}`);
  }
});

test("non-date headings do not split", async () => {
  const t = await parseImportFile({
    name: "x.md",
    text: "## Not a date\nfirst\n## Also not a date\nstill first",
  });
  assert.equal(t.entries.length, 1);
  assert.match(t.entries[0].body, /Not a date/);
});

test("parseDateHeading rejects headings without a full date", () => {
  assert.equal(parseDateHeading("March 2024"), null);
  assert.equal(parseDateHeading("2024-03"), null);
  assert.equal(parseDateHeading("2024-13-05"), null);
  assert.equal(parseDateHeading("Notes"), null);
  assert.equal(parseDateHeading("2024-03-99"), null);
});

test("preamble before the first dated heading becomes an undated entry", async () => {
  const t = await parseImportFile({
    name: "x.md",
    text: "Preamble text.\n\n## 2024-03-05\ndated body",
    lastModified: Date.UTC(2023, 0, 15),
  });
  assert.equal(t.entries.length, 2);
  assert.equal(t.entries[0].body, "Preamble text.");
  assert.equal(t.entries[0].date, "2023-01-15");
  assert.equal(t.entries[1].date, "2024-03-05");
});

test("no dated headings yields one entry dated by the file", async () => {
  const t = await parseImportFile({
    name: "x.txt",
    text: "Plain notes.",
    lastModified: Date.UTC(2023, 5, 7),
  });
  assert.equal(t.entries.length, 1);
  assert.equal(t.entries[0].date, "2023-06-07");
});

test("CRLF and BOM are normalized", async () => {
  const t = await parseImportFile({
    name: "x.md",
    text: "\uFEFF# Title\r\n\r\nLine one.\r\nLine two.\r\n",
  });
  assert.equal(t.title, "Title");
  assert.equal(t.entries[0].body, "Line one.\nLine two.");
});

test("empty file warns and yields no entries", async () => {
  const t = await parseImportFile({ name: "x.md", text: "   \n\n" });
  assert.equal(t.entries.length, 0);
  assert.deepEqual(t.warnings, ["No text found."]);
});

test("a long section splits at a blank line and warns", async () => {
  const a = "a".repeat(IMPORT_LIMITS.maxEntryChars - 10);
  const b = "b".repeat(100);
  const t = await parseImportFile({
    name: "x.md",
    text: `${a}\n\n${b}`,
  });
  assert.equal(t.entries.length, 2);
  assert.deepEqual(t.warnings, ["Split a long section into 2 entries."]);
  assert.equal(t.entries[0].body, a);
  assert.equal(t.entries[1].body, b);
});

test("hashes are stable and content-sensitive", async () => {
  const one = await parseImportFile({ name: "x.md", text: "Same body." });
  const two = await parseImportFile({ name: "x.md", text: "Same body." });
  const three = await parseImportFile({ name: "x.md", text: "Same  body." });
  assert.equal(one.hash, two.hash);
  assert.equal(one.entries[0].hash, two.entries[0].hash);
  assert.notEqual(one.entries[0].hash, three.entries[0].hash);
  assert.match(one.hash, /^[0-9a-f]{64}$/);
});

test("deterministicId is stable, uuid-shaped, and varies by parts", async () => {
  const a = await deterministicId("import-seed", "tenant", "plot", "x");
  const b = await deterministicId("import-seed", "tenant", "plot", "x");
  const c = await deterministicId("import-seed", "tenant", "plot", "y");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(
    a,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("sha256Hex matches the known digest", async () => {
  assert.equal(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
