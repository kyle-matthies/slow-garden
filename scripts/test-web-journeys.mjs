// Run against the disposable stack used by test-local-http.mjs and web on :3148.
// Uses only generated synthetic identities; never connects to a hosted project.
// Deletion is checked only when the web server on :3148 was started with
// GARDEN_DELETION_ENABLED=true; pass the same variable to this script so it
// knows which of the two states to expect (off: no delete control anywhere).
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../applications/web/package.json", import.meta.url),
);
const browserRequire = createRequire(
  new URL("../prototypes/mobile-h1/package.json", import.meta.url),
);
const { chromium, expect } = browserRequire("@playwright/test");
const { createClient } = require("@supabase/supabase-js");
const config = JSON.parse(await readFile(".local-runtime/status.json", "utf8"));
assert.equal(config.API_URL, "http://127.0.0.1:55321");
const base = "http://localhost:3148";
const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `ux-${Date.now()}@example.test`;
// A second identity with no garden yet, for the first-run journey.
const newcomer = `ux-new-${Date.now()}@example.test`;
const deletionOn = process.env.GARDEN_DELETION_ENABLED === "true";
let newcomerId;
const { data: link, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
});
assert.equal(error, null);
const userId = link.user.id;
const ids = Object.fromEntries(
  ["garden", "other", "topic", "topic2", "thought", "thought2", "entry"].map(
    (k) => [k, crypto.randomUUID()],
  ),
);
const rows = [
  ["gardens", { id: ids.garden, tenant_id: userId, name: "Test Garden" }],
  ["gardens", { id: ids.other, tenant_id: userId, name: "Other Garden" }],
  [
    "plots",
    {
      id: ids.topic,
      tenant_id: userId,
      garden_id: ids.garden,
      name: "Reading",
      ai_enabled: true,
      cross_pollinate: true,
    },
  ],
  [
    "plots",
    {
      id: ids.topic2,
      tenant_id: userId,
      garden_id: ids.garden,
      name: "Making",
    },
  ],
  [
    "seeds",
    {
      id: ids.thought,
      tenant_id: userId,
      garden_id: ids.garden,
      plot_id: ids.topic,
      title: "A question",
    },
  ],
  [
    "seeds",
    {
      id: ids.thought2,
      tenant_id: userId,
      garden_id: ids.garden,
      plot_id: ids.topic2,
      title: "A sketch",
    },
  ],
];
let context;
const profile = `.local-runtime/browser-${Date.now()}`;
let page;
// The top bar: Meadow / Pages, Returns, All gardens, and the More menu.
const tools = () => page.getByRole("navigation", { name: "Garden tools" });
async function fromMore(name) {
  await tools().getByRole("button", { name: "More", exact: true }).click();
  await tools().getByRole("button", { name, exact: true }).click();
}
// Pages: topics are bed cards at garden level, thoughts are specimen cards.
const openTopic = (name) =>
  page.locator(".bed-card").filter({ hasText: name }).click();
const openThought = (title) =>
  page.locator(".specimen-card").filter({ hasText: title }).click();
const ring = () => page.getByRole("region", { name: "All your gardens" });
// Sign in through the form with a local one-time code read by the admin
// client; no external mail is delivered.
async function signIn(address) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Email address").fill(address);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  const fresh = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: address,
  });
  assert.equal(fresh.error, null);
  await page.getByLabel("Six-digit code").fill(fresh.data.properties.email_otp);
  await page.getByRole("button", { name: "Open my garden" }).click();
  return fresh.data.user.id;
}
await mkdir(profile, { recursive: true });
try {
  const fixture = createClient(config.API_URL, config.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  assert.equal(
    (
      await fixture.auth.verifyOtp({
        email,
        token: link.properties.email_otp,
        type: "email",
      })
    ).error,
    null,
  );
  for (const [table, row] of rows)
    assert.equal((await fixture.from(table).insert(row)).error, null);
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(15000);
  page = context.pages()[0];
  page.on("dialog", (dialog) => dialog.accept());
  await signIn(email);
  await expect(
    page.getByRole("heading", { name: "Test Garden", exact: true }),
  ).toBeVisible();
  for (const path of ["/", "/login"]) {
    await page.goto(base + path);
    await expect(page).toHaveURL(/\/garden/);
  }
  assert.ok(
    (await context.cookies()).some(
      (c) =>
        c.name.includes("auth-token") && c.expires > Date.now() / 1000 + 86400,
    ),
    "persistent auth cookies",
  );
  await context.close();
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(15000);
  page = context.pages()[0];
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(base + "/login");
  await expect(page).toHaveURL(/\/garden/);
  console.log(
    "PASS: OTP, authenticated entry redirects, persistent cookies, browser restart",
  );
  // Pages is the structured view; choosing it is remembered for later visits.
  await tools().getByRole("button", { name: "Pages", exact: true }).click();
  await openTopic("Reading");
  await openThought("A question");
  await expect(page).toHaveURL(new RegExp(`thought=${ids.thought}`));
  await page
    .getByRole("textbox", { name: "New entry", exact: true })
    .fill("Synthetic first entry, saved and findable.");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.locator(".journal-entry")).toHaveCount(1);
  await expect(page.locator(".journal-entry time").first()).toContainText(
    /\d+:\d+/,
  );
  await expect(page.locator(".journal-entry")).toContainText(
    "Synthetic first entry",
  );
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Revise entry", exact: true })
    .fill("Synthetic revised entry.");
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await expect(page.locator(".journal-entry")).toContainText(
    "Synthetic revised entry.",
  );
  await page
    .getByRole("textbox", { name: "New entry", exact: true })
    .fill("Synthetic second entry.");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page.locator(".journal-entry")).toHaveCount(2);
  await expect(page.locator(".journal-entry").first()).toContainText(
    "Synthetic second entry.",
  );
  await page.screenshot({
    path: ".local-runtime/desktop-thought.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A question", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "New entry", exact: true })
    .fill("Unsaved draft");
  await page
    .getByRole("button", { name: "Topic: Reading", exact: true })
    .click();
  await page.goBack();
  await expect(
    page.getByRole("textbox", { name: "New entry", exact: true }),
  ).toHaveValue("Unsaved draft");
  await page.getByRole("textbox", { name: "New entry", exact: true }).fill("");
  await page.getByRole("link", { name: "Slow Garden" }).click();
  await expect(
    page.getByRole("heading", { name: "Test Garden", exact: true }),
  ).toBeVisible();
  await page.locator(".recent-writing > summary").click();
  await page.locator(".recent-writing li button").first().click();
  await expect(page.locator(".journal-entry").first()).toBeVisible();
  console.log(
    "PASS: topic/thought location, reload, Back, draft recovery, recent entry link, timestamp",
  );
  await page
    .locator(".journal-entry")
    .first()
    .getByRole("button", { name: "Archive entry", exact: true })
    .click();
  await expect(page.locator(".journal-entry")).toHaveCount(1);
  await fromMore("Archive");
  await openTopic("Reading");
  await openThought("A question");
  await expect(page.locator(".journal-entry")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Restore entry", exact: true })
    .click();
  await expect(page.locator(".journal-entry")).toHaveCount(0);
  await fromMore("Leave archive");
  await openTopic("Reading");
  await openThought("A question");
  await expect(page.locator(".journal-entry")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Archive thought", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restore this thought" }),
  ).toBeVisible();
  await fromMore("Archive");
  await openTopic("Reading");
  await openThought("A question");
  await expect(page.locator(".journal-entry")).toHaveCount(2);
  await page.getByRole("button", { name: "Restore this thought" }).click();
  await expect(
    page.getByRole("button", { name: "Archive thought" }),
  ).toBeVisible();
  await fromMore("Leave archive");
  await openTopic("Reading");
  await page.getByText("Topic settings ·", { exact: false }).click();
  await page
    .getByRole("button", { name: "Archive topic", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Restore topic", exact: true }).first(),
  ).toBeVisible();
  await fromMore("Archive");
  await openTopic("Reading");
  await openThought("A question");
  await expect(
    page.getByRole("button", { name: "Archive thought", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".journal-entry")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Restore topic", exact: true })
    .click();
  await fromMore("Leave archive");
  await openTopic("Reading");
  // Deletion ships behind GARDEN_DELETION_ENABLED. Off: no delete control is
  // rendered anywhere. On: an entry is erased only after the dialog's confirm,
  // and cancelling leaves everything in place.
  await openThought("A question");
  const deleteEntry = page.getByRole("button", {
    name: "Delete entry…",
    exact: true,
  });
  if (!deletionOn) {
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await fromMore("Settings & export");
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    console.log("PASS: deletion off, no delete control in a thought or in settings");
  } else {
    await expect(page.locator(".journal-entry")).toHaveCount(2);
    await deleteEntry.first().click();
    const dialog = page.getByRole("dialog", {
      name: "Delete this entry permanently?",
    });
    await expect(dialog).toContainText("Archive hides. Delete erases, permanently.");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".journal-entry")).toHaveCount(2);
    await deleteEntry.first().click();
    await expect(dialog).toContainText("This will erase:");
    await dialog
      .getByRole("button", { name: "Delete entry permanently", exact: true })
      .click();
    await expect(page.locator(".journal-entry")).toHaveCount(1);
    // Garden and account deletion ask for a typed confirmation; opened and
    // cancelled here so the rest of the journey keeps its garden.
    await fromMore("Settings & export");
    await page
      .getByRole("button", { name: "Delete account…", exact: true })
      .click();
    const account = page.getByRole("dialog", {
      name: "Delete your account permanently?",
    });
    await expect(
      account.getByRole("button", {
        name: "Delete account permanently",
        exact: true,
      }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(account).toHaveCount(0);
    console.log("PASS: deletion on, entry cancel and confirm, account dialog cancels");
  }
  await page.goto(`${base}/garden?garden=${ids.garden}&topic=${ids.topic}&view=list`);
  // Returns is a top-level place; the full record opens inside it.
  await tools().getByRole("button", { name: /^Returns/ }).click();
  await page
    .getByRole("button", { name: "Open the full record", exact: true })
    .click();
  await expect(
    page
      .getByText(
        /Tending is not active for this account yet\. Your tending choices are saved/,
      )
      .first(),
  ).toBeVisible();
  console.log(
    "PASS: entry/thought/topic archive/restore, parent write guard, AI unavailable with consent on",
  );
  // Optional second instance tests service-enabled UI without dispatching any AI job.
  if (process.env.TEST_AI_UI === "true") {
    await page.goto(
      `http://localhost:3149/garden?garden=${ids.garden}&topic=${ids.topic}&view=returns`,
    );
    await page
      .getByRole("button", { name: "Open the full record", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Invite a reflection", exact: true }),
    ).toBeVisible();
    await page.goto(
      `http://localhost:3149/garden?garden=${ids.garden}&topic=${ids.topic2}&view=returns`,
    );
    await page
      .getByRole("button", { name: "Open the full record", exact: true })
      .click();
    await expect(
      page.getByText(/Tending is off for this topic/),
    ).toBeVisible();
    console.log(
      "PASS: service-enabled consent on/off states, without a provider request",
    );
  }

  await page.goto(`${base}/garden?garden=${ids.garden}&view=list`);
  // New gardens are planted from the ring of all gardens. "New garden" in the
  // ring's dock brings the waiting card forward with its name field open.
  await tools().getByRole("button", { name: /^All gardens/ }).click();
  await ring()
    .getByRole("button", { name: "＋ New garden", exact: true })
    .click();
  await expect(page.getByLabel("Name your garden")).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // Cancelled, the card keeps its own button and nothing was created.
  await expect(
    ring().getByRole("button", { name: "＋ New garden", exact: true }),
  ).toBeVisible();
  await ring()
    .getByRole("button", { name: "Back to this garden", exact: true })
    .click();
  await page.getByRole("button", { name: "＋ New topic", exact: true }).click();
  await page.getByLabel("Name your topic").fill("New topic fixture");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New topic fixture", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "＋ New thought", exact: true })
    .click();
  await page.getByLabel("Name your thought").fill("New thought fixture");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "New thought fixture", exact: true }),
  ).toBeVisible();
  await tools().getByRole("button", { name: /^All gardens/ }).click();
  await ring().getByRole("button", { name: /^Other Garden/ }).press("Enter");
  await ring()
    .getByRole("button", { name: "Enter Other Garden", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Other Garden", exact: true }),
  ).toBeVisible();
  await page.goto(
    `${base}/garden?garden=${ids.garden}&topic=missing&thought=missing`,
  );
  await expect(
    page.getByText(/That location is no longer available/),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "mobile has no horizontal overflow",
  );
  await page.screenshot({
    path: ".local-runtime/mobile-overview.png",
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "A");
  console.log(
    "PASS: one-click creation, garden switch, stale location, mobile width, keyboard entry",
  );
  // Phone: the same navigation is a bar at the bottom of the screen, Meadow,
  // Pages, Write, Returns, More. Write is one tap from anywhere and puts the
  // caret on a page; More opens upward as a sheet.
  await page.goto(`${base}/garden?garden=${ids.garden}&view=list`);
  for (const name of ["Meadow", "Pages", "Write", "More"])
    await expect(
      tools().getByRole("button", { name, exact: true }),
    ).toBeVisible();
  await expect(tools().getByRole("button", { name: /^Returns/ })).toBeVisible();
  const bar = await page.locator(".garden-top").boundingBox();
  assert.ok(bar && bar.y + bar.height >= 844 - 1, "tab bar sits at the bottom");
  await tools().getByRole("button", { name: "Write", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "New entry", exact: true }),
  ).toBeFocused();
  await page.goto(`${base}/garden?garden=${ids.garden}&view=list`);
  await tools().getByRole("button", { name: "More", exact: true }).click();
  await expect(
    tools().getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    tools().getByRole("button", { name: "Sign out", exact: true }),
  ).toBeHidden();
  console.log("PASS: phone tab bar, Write lands on the page, More sheet opens and closes");
  await fromMore("Sign out");
  await expect(page).toHaveURL(/\/login/);
  await page.goto(base + "/garden");
  await expect(page).toHaveURL(/\/login/);
  console.log("PASS: device sign-out returns to login");
  // First run, for an identity with no garden: no required onboarding. A seed
  // pack can be opened and closed without a write; the blank page is enough.
  await page.setViewportSize({ width: 1280, height: 900 });
  newcomerId = await signIn(newcomer);
  await expect(
    page.getByRole("heading", { name: "Begin with one thought.", exact: true }),
  ).toBeVisible();
  const packet = page.locator(".seed-packet").first();
  await packet.click();
  await expect(page.locator(".seed-beds").first()).toBeVisible();
  await expect(page.locator(".seed-packs-tally")).toContainText(
    "will be planted when you save",
  );
  await packet.click();
  await expect(page.locator(".seed-packs-tally")).toContainText("No pack opened");
  await page.getByLabel("Name your garden", { exact: true }).fill("First Garden");
  await page
    .getByLabel("Write a first entry", { exact: true })
    .fill("Synthetic first-run entry.");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(page).toHaveURL(/thought=/);
  await expect(page.locator(".journal-entry")).toContainText(
    "Synthetic first-run entry.",
  );
  console.log("PASS: first run, seed pack opened and closed, blank page saved");
  await fromMore("Sign out");
  await expect(page).toHaveURL(/\/login/);
} catch (error) {
  if (context) {
    await context.pages()[0].screenshot({
      path: ".local-runtime/journey-failure.png",
      fullPage: true,
    });
    console.error(
      (await context.pages()[0].locator("body").innerText()).slice(0, 5000),
    );
  }
  throw error;
} finally {
  if (context) await context.close();
  assert.equal((await admin.auth.admin.deleteUser(userId)).error, null);
  if (newcomerId)
    assert.equal((await admin.auth.admin.deleteUser(newcomerId)).error, null);
}
