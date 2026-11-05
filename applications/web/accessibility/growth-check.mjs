// Synthetic browser journeys only. No hosted credentials, notes, or provider calls.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
const here = path.dirname(fileURLToPath(import.meta.url));
const receipt = process.env.GROWTH_RECEIPTS || "/tmp/slow-garden-growth-20261104";
const env = { ...process.env, GARDEN_AXE_FIXTURES: "1" };
for (const key of Object.keys(env)) if (/SUPABASE|GARDEN_AI|OPENAI/i.test(key)) delete env[key];
const base = "http://127.0.0.1:3214";
const server = spawn("npx", ["next", "start", "-p", "3214"], { cwd: path.resolve(here, ".."), env, detached: true, stdio: "ignore" });
let browser;
const results = [];
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (attempt === 79) throw Error("Production fixture server did not start");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch(process.env.AXE_CHROMIUM ? { executablePath: process.env.AXE_CHROMIUM } : {});
  mkdirSync(receipt, { recursive: true });
  for (const width of [390, 1280]) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/dev/axe-fixtures`, { waitUntil: "networkidle" });
    const resume = page.locator("details.recent-writing");
    await expect(resume).toBeVisible();
    await expect(resume).not.toHaveAttribute("open", "");
    await resume.locator("summary").focus();
    await page.keyboard.press("Enter");
    const items = resume.getByRole("button");
    await expect(items).toHaveCount(3);
    await page.screenshot({ path: path.join(receipt, `resume-${width}-${colorScheme}.png`), fullPage: true });
    await items.first().click();
    await expect(page).toHaveURL(/thought=.*#entry-/);
    const anchor = new URL(page.url()).hash;
    await expect(page.locator(anchor)).toBeVisible();
    await page.goto(`${base}/dev/axe-fixtures?view=list`, { waitUntil: "networkidle" });
    const more = page.getByRole("button", { name: "More", exact: true });
    if (await more.isVisible()) await more.click();
    await page.getByRole("button", { name: "Settings & export", exact: true }).click();
    await expect(page.getByRole("region", { name: "Tending activity" })).toContainText("Completed");
    await expect(page.getByRole("region", { name: "Tending activity" })).toContainText("does not confirm an overnight schedule");
    await page.goto(`${base}/dev/axe-fixtures?state=import`, { waitUntil: "networkidle" });
    let writes = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.headers()["next-action"]) writes++; });
    await page.getByLabel("Files", { exact: true }).setInputFiles({ name: "Synthetic.md", mimeType: "text/markdown", buffer: Buffer.from("# Synthetic thought\n\n## 2026-10-01\nA synthetic import check.") });
    const confirm = page.getByRole("button", { name: /^Import 1 thought into/ });
    await expect(confirm).toBeEnabled();
    expect(writes).toBe(0);
    await confirm.click();
    await expect(page.locator(".import-summary")).toContainText("0 thoughts imported.");
    await expect(page.getByRole("button", { name: /^Retry 1 thought into/ })).toBeEnabled();
    expect(writes).toBe(1);
    await expect(page.getByLabel("Title for Synthetic.md")).toBeDisabled();
    await page.goto(`${base}/dev/axe-fixtures?state=first-run`, { waitUntil: "networkidle" });
    const gardenName = page.getByLabel("Name your garden", { exact: true });
    await expect(gardenName).toBeEnabled();
    await gardenName.fill("Synthetic recovered garden");
    // Use the browser's real draft backend, then model an interruption after
    // areas were saved. No server action or hosted source is involved.
    const readCheckpoint = () => page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("slow-garden-drafts", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction("drafts").objectStore("drafts").getAll();
          request.onsuccess = () => resolve(request.result.find((r) => r.seedId === "first-run-onboarding"));
          request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    });
    await expect.poll(async () => JSON.parse((await readCheckpoint())?.body ?? "{}").gardenName).toBe("Synthetic recovered garden");
    await page.reload({ waitUntil: "networkidle" });
    await expect(gardenName).toHaveValue("Synthetic recovered garden");
    const checkpoint = await readCheckpoint();
    const interrupted = {
      ...checkpoint,
      body: JSON.stringify({
        ...JSON.parse(checkpoint.body), step: 4,
        gardenId: "00000000-0000-4000-8000-000000000010",
        topicId: "00000000-0000-4000-8000-000000000100",
        thoughtId: "00000000-0000-4000-8000-000000001000",
        body: "Synthetic unfinished first entry.",
      }),
      updatedAt: Date.now(),
    };
    await page.evaluate(async (record) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("slow-garden-drafts", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise((resolve, reject) => {
          const transaction = db.transaction("drafts", "readwrite");
          transaction.objectStore("drafts").put(record);
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
      } finally { db.close(); }
    }, interrupted);
    await page.goto(`${base}/dev/axe-fixtures`, { waitUntil: "networkidle" });
    await expect(page.getByLabel("Write a first entry", { exact: true })).toHaveValue("Synthetic unfinished first entry.");
    await expect(page.locator(".first-run-step")).toContainText("Step 4 of 4");
    await page.screenshot({ path: path.join(receipt, `recovery-${width}-${colorScheme}.png`), fullPage: true });
    expect(writes).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    results.push({ width, colorScheme, exact_entry_resume: true, tending_history: true, preview_no_write: true, failed_import_retry: true, setup_reload: true, setup_partial_garden_recovery: true, overflow: false, page_errors: 0 });
    await context.close();
  }
  writeFileSync(path.join(receipt, "journeys.json"), JSON.stringify({ synthetic_only: true, results, ok: true }, null, 2));
  console.log(JSON.stringify({ ok: true, profiles: results.length, receipt }));
} finally {
  await browser?.close();
  try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
}
