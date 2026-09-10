export type ImportedEntry = {
  body: string;
  date: string | null;
  hash: string;
};
export type ImportedThought = {
  title: string;
  sourceName: string;
  hash: string;
  entries: ImportedEntry[];
  warnings: string[];
};
export const IMPORT_LIMITS = {
  maxFiles: 50,
  maxFileBytes: 200_000,
  maxEntryChars: 20_000,
} as const;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function deterministicId(...parts: string[]): Promise<string> {
  const hex = await sha256Hex(parts.join("\u0000"));
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-8" +
    hex.slice(13, 16) +
    "-" +
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const SUFFIX = String.raw`(?:\s*[-\u00b7]\s+.*)?$`;

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function parseDateHeading(text: string): string | null {
  const line = text.trim();
  let m = line.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+[A-Za-z]+)?(?:\s*[-\u00b7]\s+.*)?$/,
  );
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = line.match(
    new RegExp(
      `^(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${SUFFIX}`,
      "i",
    ),
  );
  if (m) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = line.match(
    new RegExp(
      `^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\.?,?\\s+(\\d{4})${SUFFIX}`,
      "i",
    ),
  );
  if (m) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

function splitLong(body: string): string[] {
  const limit = IMPORT_LIMITS.maxEntryChars;
  if (body.length <= limit) return [body];
  const chunks: string[] = [];
  let rest = body;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = window.lastIndexOf("\n\n");
    const at = cut > 0 ? cut : limit;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

export async function parseImportFile(file: {
  name: string;
  text: string;
  lastModified?: number | null;
}): Promise<ImportedThought> {
  const warnings: string[] = [];
  const text = file.text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+$/, "");
  const lines = text.split("\n");

  let title: string | null = null;
  let contentStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      contentStart = i + 1;
      continue;
    }
    const m = line.match(/^#\s+(.+)$/);
    if (m) {
      title = m[1].replace(/#+\s*$/, "").trim();
      contentStart = i + 1;
    }
    break;
  }
  if (!title) {
    const base = file.name
      .replace(/\.(md|markdown|txt)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    title = base || "Imported notes";
  }
  title = title.slice(0, 160) || "Imported notes";

  const fileDate = file.lastModified
    ? new Date(file.lastModified).toISOString().slice(0, 10)
    : null;

  const sections: { date: string | null; body: string[] }[] = [];
  let current: { date: string | null; body: string[] } = {
    date: null,
    body: [],
  };
  let sawDated = false;
  for (const line of lines.slice(contentStart)) {
    const h = line.match(/^#{1,6}\s+(.+)$/);
    const date = h ? parseDateHeading(h[1]) : null;
    if (h && date) {
      sawDated = true;
      sections.push(current);
      current = { date, body: [] };
    } else {
      current.body.push(line);
    }
  }
  sections.push(current);

  const raw: { body: string; date: string | null }[] = [];
  if (sawDated) {
    for (const s of sections) {
      const body = s.body.join("\n").trim();
      if (body) raw.push({ body, date: s.date ?? fileDate });
    }
  } else {
    const body = lines.slice(contentStart).join("\n").trim();
    if (body) raw.push({ body, date: fileDate });
  }

  const entries: ImportedEntry[] = [];
  for (const e of raw) {
    const chunks = splitLong(e.body);
    if (chunks.length > 1)
      warnings.push(`Split a long section into ${chunks.length} entries.`);
    for (const body of chunks)
      entries.push({ body, date: e.date, hash: await sha256Hex(body) });
  }
  if (!entries.length) warnings.push("No text found.");

  return {
    title,
    sourceName: file.name,
    hash: await sha256Hex(
      title + "\n" + entries.map((e) => e.hash).join("\n"),
    ),
    entries,
    warnings,
  };
}
