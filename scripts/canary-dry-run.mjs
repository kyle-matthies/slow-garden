// This is an offline canary using an in-memory fake provider and ledger.
// It uses clearly synthetic fixture text and never makes network requests.
// This output is a dry-run report, not a hosted receipt or production evidence.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runOne } from "../supabase/functions/_shared/garden-runtime.mjs";

const FIVE_MINUTES = 5 * 60 * 1000;
const TWO_MINUTES = 2 * 60 * 1000;
const PASS_ESTIMATE_CENTS = 400;
const FIXTURE_BODY = "Synthetic canary source: a quieter workspace returns.";
const INTERPRETATION = "The synthetic source returns to a quieter workspace.";
const providers = [];
const fixture = [
  {
    revision_id: "synthetic-r1",
    body: FIXTURE_BODY,
    seed_id: "synthetic-s1",
    plot_id: "synthetic-p1",
  },
];

class FakeClock {
  #time = Date.parse("2026-01-15T12:00:00.000Z");

  now() {
    return this.#time;
  }

  advance(milliseconds) {
    this.#time += milliseconds;
  }
}

class FakeProvider {
  files = new Map();
  batches = new Map();
  uploads = 0;
  batchesCreated = 0;
  cancels = 0;
  downloads = 0;
  deletes = 0;
  nextFile = 1;
  nextBatch = 1;

  async upload(text) {
    const id = `file-${this.nextFile++}`;
    this.files.set(id, text);
    this.uploads += 1;
    return id;
  }

  async createBatch(inputFileId) {
    const id = `batch-${this.nextBatch++}`;
    this.batches.set(id, {
      status: "in_progress",
      input_file_id: inputFileId,
    });
    this.batchesCreated += 1;
    return id;
  }

  async getBatch(id) {
    const batch = this.batches.get(id);
    assert.ok(batch, `unknown fake batch ${id}`);
    if (batch.status === "cancelling") batch.status = "cancelled";
    return { ...batch };
  }

  async cancelBatch(id) {
    const batch = this.batches.get(id);
    assert.ok(batch, `unknown fake batch ${id}`);
    this.cancels += 1;
    batch.status = "cancelling";
  }

  async download(id) {
    this.downloads += 1;
    assert.ok(this.files.has(id), `unknown fake file ${id}`);
    return this.files.get(id);
  }

  async deleteFile(id) {
    this.deletes += 1;
    this.files.delete(id);
  }

  complete(id, resultLine) {
    const batch = this.batches.get(id);
    assert.ok(batch, `unknown fake batch ${id}`);
    const outputFileId = `file-${this.nextFile++}`;
    this.files.set(outputFileId, resultLine);
    Object.assign(batch, { status: "completed", output_file_id: outputFileId });
  }

  expire(id) {
    const batch = this.batches.get(id);
    assert.ok(batch, `unknown fake batch ${id}`);
    const outputFileId = `file-${this.nextFile++}`;
    this.files.set(outputFileId, "");
    Object.assign(batch, { status: "expired", output_file_id: outputFileId });
  }

  filesRemaining() {
    return this.files.size;
  }
}

class FakeLedger {
  constructor(clock, { hardCapCents = 1500 } = {}) {
    this.clock = clock;
    this.enabled = true;
    this.hardCapCents = hardCapCents;
    this.softCapCents = 1000;
    this.reservedCents = 0;
    this.spentCents = 0;
    this.passes = new Map();
    this.nextPass = 1;
    this.forceLeaseLossOn = null;
  }

  createPass(tenantId, snapshot = fixture) {
    if (
      [...this.passes.values()].some(
        (pass) =>
          pass.tenantId === tenantId &&
          ["queued", "processing"].includes(pass.status),
      )
    )
      throw Error("a reflection is already in progress");
    if (
      this.reservedCents + this.spentCents + PASS_ESTIMATE_CENTS >
      this.hardCapCents
    )
      throw Error("AI budget reached");
    const id = `pass-${this.nextPass++}`;
    const pass = {
      id,
      tenantId,
      gardenId: "synthetic-garden",
      status: "queued",
      created_at: new Date(this.clock.now()).toISOString(),
      snapshot,
      corrections: [],
      model: "synthetic-model",
      workflow_version: "synthetic-v1",
      provider_id: null,
      input_file_id: null,
      output_file_id: null,
      attempts: 0,
      actualCents: null,
      reservedCents: PASS_ESTIMATE_CENTS,
      inputRate: 1000,
      outputRate: 5000,
      leaseUntil: null,
      leaseToken: null,
      nextAttemptAt: this.clock.now(),
      cleanupPending: false,
      blooms: [],
    };
    this.passes.set(id, pass);
    this.reservedCents += PASS_ESTIMATE_CENTS;
    return pass;
  }

  cancelPass(pass) {
    if (["queued", "processing"].includes(pass.status)) {
      pass.status = "cancelled";
      pass.cleanupPending = true;
      pass.nextAttemptAt = this.clock.now();
    }
  }

  #validLease(pass, token) {
    return (
      pass?.leaseToken === token &&
      pass.leaseUntil !== null &&
      pass.leaseUntil > this.clock.now()
    );
  }

  #claimable(pass) {
    const active =
      ["queued", "processing"].includes(pass.status) && this.enabled;
    const cleanup =
      ["cancelled", "withdrawn", "failed", "complete"].includes(pass.status) &&
      pass.cleanupPending;
    return (
      (active || cleanup) &&
      pass.nextAttemptAt <= this.clock.now() &&
      (pass.leaseUntil === null || pass.leaseUntil <= this.clock.now())
    );
  }

  #job(pass) {
    return {
      id: pass.id,
      token: pass.leaseToken,
      status: pass.status,
      snapshot: pass.snapshot,
      corrections: pass.corrections,
      model: pass.model,
      workflow_version: pass.workflow_version,
      provider_id: pass.provider_id,
      input_file_id: pass.input_file_id,
      output_file_id: pass.output_file_id,
      attempts: pass.attempts,
      created_at: pass.created_at,
      settled: pass.actualCents !== null,
    };
  }

  async rpc(name, args) {
    if (this.forceLeaseLossOn === name) {
      this.forceLeaseLossOn = null;
      throw Error("lease lost");
    }
    if (name === "claim_garden_pass") {
      const pass = [...this.passes.values()]
        .filter((candidate) => this.#claimable(candidate))
        .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)[0];
      if (!pass) return null;
      pass.leaseUntil = this.clock.now() + TWO_MINUTES;
      pass.leaseToken = `token-${pass.id}-${pass.attempts + 1}`;
      pass.attempts += 1;
      if (pass.status === "queued") pass.status = "processing";
      return this.#job(pass);
    }
    if (name === "check_garden_pass") {
      const pass = this.passes.get(args.p_id);
      return Boolean(
        this.#validLease(pass, args.p_token) &&
          ["queued", "processing"].includes(pass.status) &&
          this.enabled,
      );
    }
    const pass = this.passes.get(args.p_id);
    if (!this.#validLease(pass, args.p_token)) throw Error("lease lost");
    if (name === "update_garden_job") {
      if (args.p_provider !== undefined && args.p_provider !== null)
        pass.provider_id = args.p_provider;
      if (args.p_input_file !== undefined && args.p_input_file !== null)
        pass.input_file_id = args.p_input_file;
      if (args.p_output_file !== undefined && args.p_output_file !== null)
        pass.output_file_id = args.p_output_file;
      pass.cleanupPending = !args.p_clean;
      if (args.p_release) {
        pass.leaseUntil = null;
        pass.leaseToken = null;
        pass.nextAttemptAt = this.clock.now() + FIVE_MINUTES;
      }
      return null;
    }
    if (name === "finish_garden_pass") {
      if (pass.actualCents !== null) return null;
      const active = await this.rpc("check_garden_pass", {
        p_id: pass.id,
        p_token: args.p_token,
      });
      if (active && !args.p_failed) {
        const blooms = args.p_result?.blooms;
        if (!Array.isArray(blooms) || blooms.length > 3)
          throw Error("invalid bloom count");
        for (const bloom of blooms) {
          if (!Array.isArray(bloom.evidence) || bloom.evidence.length < 1)
            throw Error("evidence required");
          for (const evidence of bloom.evidence) {
            const source = pass.snapshot.find(
              (item) => item.revision_id === evidence.revision_id,
            );
            if (!source || !evidence.excerpt || !source.body.includes(evidence.excerpt))
              throw Error("invalid source evidence");
          }
        }
        pass.blooms = blooms;
      }
      const inputTokens = args.p_input_tokens ?? 0;
      const outputTokens = args.p_output_tokens ?? 0;
      const cost =
        inputTokens + outputTokens > 0
          ? (Math.max(inputTokens, 0) * pass.inputRate +
              Math.max(outputTokens, 0) * pass.outputRate) /
            1_000_000
          : pass.reservedCents;
      this.reservedCents = Math.max(
        0,
        this.reservedCents - pass.reservedCents,
      );
      this.spentCents += cost;
      pass.actualCents = cost;
      pass.cleanupPending = true;
      pass.leaseUntil = null;
      pass.leaseToken = null;
      pass.nextAttemptAt = this.clock.now();
      pass.status = !active
        ? pass.status === "withdrawn"
          ? "withdrawn"
          : "cancelled"
        : args.p_failed
          ? "failed"
          : "complete";
      return null;
    }
    throw Error(`unknown rpc ${name}`);
  }
}

function resultLine(id, { duplicate = false } = {}) {
  const line = JSON.stringify({
    custom_id: id,
    response: {
      status_code: 200,
      body: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  blooms: [
                    {
                      kind: "question",
                      interpretation: INTERPRETATION,
                      evidence: [
                        {
                          revision_id: fixture[0].revision_id,
                          excerpt: "a quieter workspace returns",
                        },
                      ],
                    },
                  ],
                  no_output_reason: null,
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    },
  });
  return duplicate ? `${line}\n${line}` : line;
}

function environment(options) {
  const clock = new FakeClock();
  const ledger = new FakeLedger(clock, options);
  const provider = new FakeProvider();
  providers.push(provider);
  return { clock, ledger, provider };
}

async function step(env) {
  return runOne({
    rpc: (name, args) => env.ledger.rpc(name, args),
    provider: env.provider,
    now: () => env.clock.now(),
  });
}

async function submit(env, tenantId) {
  const pass = env.ledger.createPass(tenantId);
  const result = await step(env);
  assert.equal(result.state, "submitted");
  return pass;
}

async function drain(env, steps) {
  let sawWork = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await step(env);
    if (result.state === "idle") {
      if (sawWork) return;
      env.clock.advance(FIVE_MINUTES);
      continue;
    }
    sawWork = true;
    steps.push({ state: result.state });
    if (["waiting", "cancelling"].includes(result.state))
      env.clock.advance(FIVE_MINUTES);
  }
  throw Error("drain_limit");
}

function scenario(name, execute) {
  return async () => {
    try {
      return await execute();
    } catch {
      return {
        name,
        steps: [],
        ok: false,
        checks: [{ check: "scenario_completed", ok: false }],
      };
    }
  };
}

const scenarios = [
  scenario("submit_and_complete", async () => {
    const env = environment();
    const steps = [];
    const pass = await submit(env, "tenant-a");
    steps.push({ state: "submitted" });
    env.provider.complete(pass.provider_id, resultLine(pass.id));
    env.clock.advance(FIVE_MINUTES);
    const completed = await step(env);
    steps.push({ state: completed.state });
    await drain(env, steps);
    const checks = [
      { check: "one_bloom_stored", ok: pass.blooms.length === 1 },
      { check: "spent_cents_positive", ok: env.ledger.spentCents > 0 },
      { check: "reservation_released", ok: env.ledger.reservedCents === 0 },
      { check: "files_deleted", ok: env.provider.filesRemaining() === 0 },
      {
        check: "cleanup_pending_false",
        ok: pass.cleanupPending === false,
      },
    ];
    return { name: "submit_and_complete", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("cancel_in_flight", async () => {
    const env = environment();
    const steps = [];
    const pass = await submit(env, "tenant-a");
    steps.push({ state: "submitted" });
    env.ledger.cancelPass(pass);
    await drain(env, steps);
    const states = steps.map(({ state }) => state);
    const checks = [
      { check: "cancellation_progresses", ok: ["cancelling", "cancelled", "cleaned"].every((state) => states.includes(state)) },
      { check: "one_cancel", ok: env.provider.cancels === 1 },
      { check: "no_blooms", ok: pass.blooms.length === 0 },
      { check: "files_deleted", ok: env.provider.filesRemaining() === 0 },
      { check: "reservation_released", ok: env.ledger.reservedCents === 0 },
    ];
    return { name: "cancel_in_flight", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("expire_deadline", async () => {
    const env = environment();
    const steps = [];
    const pass = await submit(env, "tenant-a");
    steps.push({ state: "submitted" });
    env.clock.advance(31 * 60 * 60 * 1000);
    const expired = await step(env);
    steps.push({ state: expired.state });
    await drain(env, steps);
    const checks = [
      { check: "deadline_expired", ok: expired.reason === "deadline" },
      { check: "one_cancel", ok: env.provider.cancels === 1 },
      { check: "no_download", ok: env.provider.downloads === 0 },
      { check: "full_reservation_charged", ok: env.ledger.spentCents === PASS_ESTIMATE_CENTS },
      { check: "files_deleted", ok: env.provider.filesRemaining() === 0 },
    ];
    return { name: "expire_deadline", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("expire_provider", async () => {
    const env = environment();
    const steps = [];
    const pass = await submit(env, "tenant-a");
    steps.push({ state: "submitted" });
    env.provider.expire(pass.provider_id);
    env.clock.advance(FIVE_MINUTES);
    const expired = await step(env);
    steps.push({ state: expired.state });
    await drain(env, steps);
    const checks = [
      { check: "provider_expired", ok: expired.reason === "provider" },
      { check: "files_deleted", ok: env.provider.filesRemaining() === 0 },
    ];
    return { name: "expire_provider", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("budget_stop", async () => {
    const env = environment({ hardCapCents: PASS_ESTIMATE_CENTS * 2 + 1 });
    const first = env.ledger.createPass("tenant-a");
    const second = env.ledger.createPass("tenant-b");
    second.nextAttemptAt += 60 * 60 * 1000;
    let rejected = false;
    try {
      env.ledger.createPass("tenant-c");
    } catch (error) {
      rejected = error.message === "AI budget reached";
    }
    env.ledger.enabled = false;
    const disabledIdle = await step(env);
    env.ledger.enabled = true;
    const submitted = await step(env);
    assert.equal(submitted.state, "submitted");
    env.provider.complete(first.provider_id, resultLine(first.id));
    env.clock.advance(FIVE_MINUTES);
    assert.equal((await step(env)).state, "complete");
    const replacement = env.ledger.createPass("tenant-c");
    env.ledger.enabled = false;
    env.ledger.cancelPass(replacement);
    const steps = [];
    await drain(env, steps);
    const checks = [
      { check: "two_initial_passes", ok: Boolean(first && second) },
      { check: "third_rejected_at_cap", ok: rejected },
      { check: "reservation_release_allows_replacement", ok: Boolean(replacement) },
      { check: "disabled_runtime_idles_active_work", ok: disabledIdle.state === "idle" },
      {
        check: "disabled_runtime_cleans_terminal_work",
        ok: steps.some((stepResult) => stepResult.state === "cleaned"),
      },
    ];
    return { name: "budget_stop", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("duplicate_result", async () => {
    const env = environment();
    const steps = [];
    const pass = await submit(env, "tenant-a");
    steps.push({ state: "submitted" });
    env.provider.complete(pass.provider_id, resultLine(pass.id, { duplicate: true }));
    env.clock.advance(FIVE_MINUTES);
    const failed = await step(env);
    steps.push({ state: failed.state });
    await drain(env, steps);
    const downloadsBeforeSettledCleanup = env.provider.downloads;
    const settled = env.ledger.createPass("tenant-b");
    settled.status = "complete";
    settled.actualCents = 1;
    settled.cleanupPending = true;
    settled.provider_id = await env.provider.createBatch("missing-input");
    env.provider.complete(settled.provider_id, resultLine(settled.id));
    assert.equal((await step(env)).state, "cleaned");
    const checks = [
      { check: "duplicate_result_fails", ok: failed.state === "failed" },
      { check: "no_blooms", ok: pass.blooms.length === 0 },
      { check: "files_deleted", ok: env.provider.filesRemaining() === 0 },
      { check: "settled_cleanup_does_not_download", ok: env.provider.downloads === downloadsBeforeSettledCleanup },
    ];
    return { name: "duplicate_result", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("lost_lease", async () => {
    const env = environment();
    const steps = [];
    const pass = await submit(env, "tenant-a");
    steps.push({ state: "submitted" });
    env.provider.complete(pass.provider_id, resultLine(pass.id));
    env.clock.advance(FIVE_MINUTES);
    env.ledger.forceLeaseLossOn = "update_garden_job";
    const lost = await step(env);
    steps.push({ state: lost.state });
    await drain(env, steps);
    const checks = [
      { check: "lease_loss_is_reported", ok: lost.state === "lease_lost" },
      { check: "one_bloom_after_retry", ok: pass.blooms.length === 1 },
      { check: "files_deleted", ok: env.provider.filesRemaining() === 0 },
    ];
    return { name: "lost_lease", steps, checks, ok: checks.every((c) => c.ok) };
  }),
];

async function main() {
  const results = [];
  for (const runScenario of scenarios) results.push(await runScenario());
  const passed = results.filter((result) => result.ok).length;
  const report = {
    generated_at: new Date().toISOString(),
    runtime: "offline-fake-provider",
    content_free: true,
    scenarios: results,
    totals: {
      scenarios: results.length,
      passed,
      failed: results.length - passed,
      provider: {
        uploads: providers.reduce((total, provider) => total + provider.uploads, 0),
        batches: providers.reduce(
          (total, provider) => total + provider.batchesCreated,
          0,
        ),
        cancels: providers.reduce((total, provider) => total + provider.cancels, 0),
        downloads: providers.reduce(
          (total, provider) => total + provider.downloads,
          0,
        ),
        deletes: providers.reduce((total, provider) => total + provider.deletes, 0),
        files_remaining: providers.reduce(
          (total, provider) => total + provider.filesRemaining(),
          0,
        ),
      },
    },
    ok: passed === results.length,
  };
  const serialized = JSON.stringify(report);
  const contentFree =
    !serialized.includes(FIXTURE_BODY) && !serialized.includes(INTERPRETATION);
  report.content_free = contentFree;
  report.ok = report.ok && contentFree;
  const outIndex = process.argv.indexOf("--out");
  if (outIndex >= 0) {
    const outputPath = process.argv[outIndex + 1];
    if (!outputPath) throw Error("--out requires a path");
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}

await main();
