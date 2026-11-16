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
// GROWTH_BASE runs the journeys against a fixture server that is already up
// (GARDEN_AXE_FIXTURES=1) instead of starting the production build on :3214.
const browserStore = process.env.NEXT_PUBLIC_GARDEN_STORE === "browser";
const external = process.env.GROWTH_BASE?.replace(/\/$/, "");
const base = external || "http://127.0.0.1:3214";
const server = external ? null : spawn("npx", ["next", "start", "-p", "3214"], { cwd: path.resolve(here, ".."), env, detached: true, stdio: "ignore" });
let browser;
const results = [];
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (attempt === 79) throw Error(`No fixture server answered at ${base}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch(process.env.AXE_CHROMIUM ? { executablePath: process.env.AXE_CHROMIUM } : {});
  mkdirSync(receipt, { recursive: true });
  // Two phones, a phone held sideways (all touch) and a desktop.
  const PROFILES = [
    { width: 360, height: 740, touch: true },
    { width: 390, height: 844, touch: true },
    { width: 844, height: 390, touch: true },
    { width: 1280, height: 844, touch: false },
  ];
  for (const { width, height, touch } of PROFILES) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, deviceScaleFactor: touch ? 2 : 1, colorScheme, reducedMotion: "reduce" });
    const page = await context.newPage();
    // The Next.js dev badge sits over the landscape rail's last item on a dev server.
    await page.addInitScript(() => { const hide = () => { const style = document.createElement("style"); style.textContent = "nextjs-portal{display:none!important}"; document.documentElement.append(style); }; if (document.documentElement) hide(); else addEventListener("DOMContentLoaded", hide); });
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
    await page.screenshot({ path: path.join(receipt, `resume-${width}x${height}-${colorScheme}.png`), fullPage: true });
    await items.first().click();
    await expect(page).toHaveURL(/thought=.*#entry-/);
    const anchor = new URL(page.url()).hash;
    await expect(page.locator(anchor)).toBeVisible();
    await page.goto(`${base}/dev/axe-fixtures?view=list`, { waitUntil: "networkidle" });
    const more = page.getByRole("button", { name: "More", exact: true });
    if (touch) {
      // Phone and rail: More opens as a sheet; Escape closes it and returns focus.
      await more.click();
      await expect(page.getByRole("button", { name: "Settings & export", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Settings & export", exact: true })).toBeHidden();
      await expect(more).toBeFocused();
    }
    if (await more.isVisible()) await more.click();
    await page.getByRole("button", { name: "Settings & export", exact: true }).click();
    // Deletion is switched on in the fixture only. The account dialog opens
    // with the safe choice available, and Escape cancels back to its button.
    const deleteAccount = page.getByRole("button", { name: "Delete account…", exact: true });
    await deleteAccount.click();
    const accountDialog = page.getByRole("dialog", { name: "Delete your account permanently?" });
    await expect(accountDialog).toBeVisible();
    await expect(accountDialog.getByRole("button", { name: "Delete account permanently", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(accountDialog).toHaveCount(0);
    await expect(deleteAccount).toBeFocused();
    // An entry's delete control: quiet until opened, cancelled without a write.
    await page.goto(`${base}/dev/axe-fixtures?topic=00000000-0000-4000-8000-000000000100&thought=00000000-0000-4000-8000-000000001000&view=list`, { waitUntil: "networkidle" });
    const deleteEntry = page.getByRole("button", { name: "Delete entry…", exact: true }).first();
    await deleteEntry.click();
    const entryDialog = page.getByRole("dialog", { name: "Delete this entry permanently?" });
    await expect(entryDialog).toBeVisible();
    await entryDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(entryDialog).toHaveCount(0);
    await expect(deleteEntry).toBeFocused();
    await page.goto(`${base}/dev/axe-fixtures?view=list`, { waitUntil: "networkidle" });
    if (await more.isVisible()) await more.click();
    await page.getByRole("button", { name: "Settings & export", exact: true }).click();
    await expect(page.getByRole("region", { name: "Tending activity" })).toContainText("Completed");
    await expect(page.getByRole("region", { name: "Tending activity" })).toContainText("does not confirm an overnight schedule");
    await page.goto(`${base}/dev/axe-fixtures?state=import`, { waitUntil: "networkidle" });
    // A write is a server action (server store) or the import RPC sent from the
    // page (a build made with NEXT_PUBLIC_GARDEN_STORE=browser; name it to this
    // script with the same variable). The fixture server has no Supabase, so the
    // browser store fails before any request leaves the page.
    let writes = 0, rpcs = 0;
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.headers()["next-action"]) writes++;
      if (/\/rest\/v1\/rpc\/import_thought/.test(request.url())) rpcs++;
    });
    await page.getByLabel("Files", { exact: true }).setInputFiles({ name: "Synthetic.md", mimeType: "text/markdown", buffer: Buffer.from("# Synthetic thought\n\n## 2026-10-01\nA synthetic import check.") });
    const confirm = page.getByRole("button", { name: /^Import 1 thought into/ });
    await expect(confirm).toBeEnabled();
    expect(writes + rpcs).toBe(0);
    await confirm.click();
    await expect(page.locator(".import-summary")).toContainText("0 thoughts imported.");
    await expect(page.getByRole("button", { name: /^Retry 1 thought into/ })).toBeEnabled();
    if (browserStore) {
      expect(writes).toBe(0);
      expect(rpcs).toBeLessThanOrEqual(1);
    } else expect(writes).toBe(1);
    await expect(page.getByLabel("Title for Synthetic.md")).toBeDisabled();
    await page.goto(`${base}/dev/axe-fixtures?state=first-run`, { waitUntil: "networkidle" });
    const gardenName = page.getByLabel("Name your garden", { exact: true });
    await expect(gardenName).toBeEnabled();
    // Seed packs: opening one shows its topics; closing it plants nothing.
    const packet = page.locator(".seed-packet").first();
    await packet.click();
    await expect(page.locator(".seed-beds").first()).toBeVisible();
    await expect(page.locator(".seed-packs-tally")).toContainText("will be planted when you save");
    await page.screenshot({ path: path.join(receipt, `first-run-pack-${width}x${height}-${colorScheme}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await packet.click();
    await expect(page.locator(".seed-beds")).toHaveCount(0);
    await expect(page.locator(".seed-packs-tally")).toContainText("No pack opened");
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
    // Recovery resumes at the entry: garden, topic and thought show as saved.
    await expect(page.locator(".first-run-model li[data-saved]")).toHaveCount(3);
    await expect(page.locator(".first-run-model li").last()).not.toHaveAttribute("data-saved");
    await expect(gardenName).toBeDisabled();
    await page.screenshot({ path: path.join(receipt, `recovery-${width}x${height}-${colorScheme}.png`), fullPage: true });
    // Opening the page and recovering the draft wrote nothing more.
    expect(writes).toBe(browserStore ? 0 : 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // The morning reveal: announced once, and a dismissal outlives a reload.
    // Setup recovery above left a first-run draft; a tended garden ignores it only
    // once that draft is gone, as it is after finishing or signing out.
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("slow-garden-drafts");
      request.onsuccess = request.onblocked = () => resolve();
      request.onerror = () => reject(request.error);
    }));
    for (const view of ["", "&view=list"]) {
      await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("slow-garden:seen-blooms:")) localStorage.removeItem(key); });
      await page.goto(`${base}/dev/axe-fixtures?state=scale&thoughts=100${view}`, { waitUntil: "networkidle" });
      const reveal = page.getByRole("region", { name: "Overnight, the garden noticed…" });
      const returnsLink = page.getByRole("navigation", { name: "Garden tools" }).getByRole("button", { name: /^Returns/ });
      await expect(reveal).toBeVisible();
      await expect(reveal.getByRole("listitem")).not.toHaveCount(0);
      expect(await reveal.getByRole("listitem").count()).toBeLessThanOrEqual(3);
      await expect(returnsLink).toContainText("new bloom");
      await expect(page.getByText(/new blooms? in Returns/)).toHaveCount(0);
      if (!view) await page.screenshot({ path: path.join(receipt, `reveal-${width}x${height}-${colorScheme}.png`) });
      await reveal.getByRole("button", { name: "Dismiss and mark as seen" }).click();
      await expect(reveal).toHaveCount(0);
      await expect(returnsLink).not.toContainText("new bloom");
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.getByRole("button", { name: "More", exact: true })).toBeVisible();
      await expect(reveal).toHaveCount(0);
      await expect(returnsLink).not.toContainText("new bloom");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    results.push({ width, height, touch, colorScheme, more_sheet: touch, delete_dialogs_cancel: true, first_run_seed_pack: true, exact_entry_resume: true, tending_history: true, preview_no_write: true, failed_import_retry: true, setup_reload: true, setup_partial_garden_recovery: true, morning_reveal_dismissal: true, overflow: false, page_errors: 0 });
    await context.close();
  }
  writeFileSync(path.join(receipt, "journeys.json"), JSON.stringify({ synthetic_only: true, results, ok: true }, null, 2));
  console.log(JSON.stringify({ ok: true, profiles: results.length, receipt }));
} finally {
  await browser?.close();
  if (server) try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
}
