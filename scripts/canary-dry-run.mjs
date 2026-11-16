// This is an offline canary using an in-memory fake provider and ledger.
// It uses clearly synthetic fixture text and never makes network requests.
// This output is a dry-run report, not a hosted receipt or production evidence.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runOne, syncLimits } from "../supabase/functions/_shared/garden-runtime.mjs";

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
  responses = 0;
  // Optional script for the synchronous call: (body) => answer, or throws.
  onRespond = null;

  // Synchronous transport: one call per stage, nothing stored at the provider.
  async respond(body) {
    this.responses += 1;
    if (this.onRespond) {
      const scripted = await this.onRespond(body);
      if (scripted) return scripted;
    }
    return syncAnswer(body);
  }

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
    // Mirrors private.ai_runtime.transport and private.ai_tenants.
    this.transport = "batch";
    this.allowlist = new Set(["tenant-a", "tenant-b", "tenant-c"]);
  }

  createPass(tenantId, snapshot = fixture, { workflowVersion = "synthetic-v1", context = {} } = {}) {
    if (!this.enabled) throw Error("AI evaluation gate has not been activated");
    if (!this.allowlist.has(tenantId))
      throw Error("tending is not available for this account yet");
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
      workflow_version: workflowVersion,
      context,
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
      marks: [],
      transport: this.transport,
      dispatches: 0,
      dispatchOpen: false,
      lostCents: 0,
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
      ["queued", "processing"].includes(pass.status) &&
      this.enabled &&
      this.allowlist.has(pass.tenantId);
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
      context: pass.context,
      model: pass.model,
      workflow_version: pass.workflow_version,
      provider_id: pass.provider_id,
      input_file_id: pass.input_file_id,
      output_file_id: pass.output_file_id,
      attempts: pass.attempts,
      created_at: pass.created_at,
      settled: pass.actualCents !== null,
      transport: pass.transport,
      dispatches: pass.dispatches,
    };
  }

  async rpc(name, args) {
    if (this.forceLeaseLossOn === name) {
      this.forceLeaseLossOn = null;
      throw Error("lease lost");
    }
    // This in-memory ledger never deletes a pass, so its orphan queue is always empty.
    if (name === "claim_provider_orphan") return null;
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
          this.enabled &&
          this.allowlist.has(pass.tenantId),
      );
    }
    const pass = this.passes.get(args.p_id);
    if (!this.#validLease(pass, args.p_token)) throw Error("lease lost");
    if (name === "mark_garden_dispatch") {
      if (pass.transport !== "sync") throw Error("not a synchronous pass");
      if (args.p_rejected) {
        pass.dispatchOpen = false;
        return "closed";
      }
      if (pass.actualCents !== null) return "settled";
      if (!(await this.rpc("check_garden_pass", args))) return "inactive";
      if (pass.dispatches >= 3) return "limit";
      if (pass.dispatchOpen) {
        // The earlier dispatch never reported back: book it at the full reservation.
        if (this.reservedCents + this.spentCents + pass.reservedCents > this.hardCapCents)
          return "budget";
        this.spentCents += pass.reservedCents;
        pass.lostCents += pass.reservedCents;
      }
      pass.dispatches += 1;
      pass.dispatchOpen = true;
      pass.leaseUntil = this.clock.now() + syncLimits.leaseMs;
      return "ok";
    }
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
        // tend-connect-v3 marks: each must quote its own thought's writing.
        for (const mark of args.p_result?.marks ?? [])
          for (const evidence of mark.evidence) {
            const source = pass.snapshot.find((item) => item.revision_id === evidence.revision_id);
            if (!source || source.seed_id !== mark.seed_id || !source.body.includes(evidence.excerpt))
              throw Error("invalid source evidence");
          }
        pass.marks = args.p_result?.marks ?? [];
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

// What the fake provider answers on the synchronous path, chosen by the stage's schema name.
function syncAnswer(body) {
  const stage = body.text.format.name;
  const evidence = [{ revision_id: fixture[0].revision_id, excerpt: "a quieter workspace returns" }];
  const value =
    stage === "garden_tend"
      ? { marks: [{ seed_id: fixture[0].seed_id, kind: "theme", label: "workspace", evidence }] }
      : stage === "garden_connect"
        ? { blooms: [], no_output_reason: null }
        : { blooms: [{ kind: "question", interpretation: INTERPRETATION, evidence }], no_output_reason: null };
  return {
    status_code: 200,
    retryable: false,
    body: {
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
}
const refusal = (status) => ({ status_code: status, body: null, retryable: status === 429 || status >= 500 });
const timeout = () => Object.assign(new Error("provider_request_failed"), { timeout: true });

function syncEnvironment(options) {
  const env = environment(options);
  env.ledger.transport = "sync";
  return env;
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
    if (["waiting", "cancelling", "retry_scheduled", "deferred"].includes(result.state))
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

function stageLine(id, stage, value) {
  return JSON.stringify({
    custom_id: `${id}:${stage}`,
    response: {
      status_code: 200,
      body: {
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
        usage: { input_tokens: 80, output_tokens: 30 },
      },
    },
  });
}

// tend-connect-v3: a valid catalogue lands even when the connect stage is invalid.
scenarios.push(
  scenario("tend_connect_partial", async () => {
    const env = environment();
    const steps = [];
    const snapshot = fixture.map((item) => ({ ...item, title: "Synthetic thought", role: "changed" }));
    const pass = env.ledger.createPass("tenant-a", snapshot, {
      workflowVersion: "tend-connect-v3-synthetic",
      context: { tiers: { catalog: true, notice: true, resurface: false } },
    });
    const submitted = await step(env);
    steps.push({ state: submitted.state });
    const uploadedLines = [...env.provider.files.values()][0].trim().split("\n").length;
    env.provider.complete(
      pass.provider_id,
      [
        stageLine(pass.id, "tend", {
          marks: [
            {
              seed_id: fixture[0].seed_id,
              kind: "theme",
              label: "workspace",
              evidence: [{ revision_id: fixture[0].revision_id, excerpt: "a quieter workspace" }],
            },
          ],
        }),
        stageLine(pass.id, "connect", {
          blooms: [{ kind: "echo", interpretation: INTERPRETATION, evidence: [] }],
          no_output_reason: null,
        }),
      ].join("\n"),
    );
    env.clock.advance(FIVE_MINUTES);
    const completed = await step(env);
    steps.push({ state: completed.state, stages: completed.stages });
    await drain(env, steps);
    const checks = [
      { check: "two_stage_lines_uploaded", ok: uploadedLines === 2 },
      { check: "catalogue_landed", ok: pass.marks.length === 1 },
      { check: "invalid_stage_shows_nothing", ok: pass.blooms.length === 0 },
      { check: "pass_complete", ok: pass.status === "complete" },
      { check: "files_deleted", ok: env.provider.filesRemaining() === 0 },
    ];
    return { name: "tend_connect_partial", steps, checks, ok: checks.every((c) => c.ok) };
  }),
);

// ---- Owner-only allowlist ---------------------------------------------------
scenarios.push(
  scenario("allowlist_empty_runs_nothing", async () => {
    const env = environment();
    env.ledger.allowlist = new Set();
    let refused = false;
    try {
      env.ledger.createPass("tenant-a");
    } catch (error) {
      refused = error.message === "tending is not available for this account yet";
    }
    const idle = await step(env);
    env.ledger.allowlist = new Set(["tenant-a"]);
    const pass = env.ledger.createPass("tenant-a");
    let otherRefused = false;
    try {
      env.ledger.createPass("tenant-b");
    } catch {
      otherRefused = true;
    }
    // The tenant leaves the allowlist with a pass queued: it is never dispatched.
    env.ledger.allowlist = new Set();
    const afterRemoval = await step(env);
    const checks = [
      { check: "empty_allowlist_refuses_pass", ok: refused },
      { check: "worker_idle", ok: idle.state === "idle" },
      { check: "allowlisted_tenant_accepted", ok: Boolean(pass) },
      { check: "other_tenant_refused", ok: otherRefused },
      { check: "removed_tenant_not_dispatched", ok: afterRemoval.state === "idle" && env.provider.uploads === 0 },
      { check: "no_provider_contact", ok: env.provider.uploads + env.provider.responses === 0 },
    ];
    return { name: "allowlist_empty_runs_nothing", steps: [{ state: idle.state }, { state: afterRemoval.state }], checks, ok: checks.every((c) => c.ok) };
  }),
);

// ---- Synchronous transport --------------------------------------------------
// Every sync scenario also proves that no file or batch is ever created.
const noFiles = (env) => ({
  check: "no_files_or_batches",
  ok: env.provider.uploads === 0 && env.provider.batchesCreated === 0 && env.provider.filesRemaining() === 0,
});

scenarios.push(
  scenario("sync_submit_and_complete", async () => {
    const env = syncEnvironment();
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    const completed = await step(env);
    steps.push({ state: completed.state });
    await drain(env, steps);
    const checks = [
      { check: "completed_in_one_invocation", ok: completed.state === "complete" && completed.transport === "sync" },
      { check: "one_provider_call", ok: env.provider.responses === 1 },
      { check: "one_bloom_stored", ok: pass.blooms.length === 1 },
      { check: "actual_usage_charged", ok: env.ledger.spentCents > 0 && env.ledger.spentCents < PASS_ESTIMATE_CENTS },
      { check: "reservation_released", ok: env.ledger.reservedCents === 0 },
      { check: "cleanup_pending_false", ok: pass.cleanupPending === false },
      noFiles(env),
    ];
    return { name: "sync_submit_and_complete", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_tend_connect", async () => {
    const env = syncEnvironment();
    const steps = [];
    const snapshot = fixture.map((item) => ({ ...item, title: "Synthetic thought", role: "changed" }));
    const pass = env.ledger.createPass("tenant-a", snapshot, {
      workflowVersion: "tend-connect-v3-synthetic",
      context: { tiers: { catalog: true, notice: true, resurface: false } },
    });
    env.provider.onRespond = (body) => (body.text.format.name === "garden_connect" ? refusal(500) : null);
    const completed = await step(env);
    steps.push({ state: completed.state, stages: completed.stages });
    await drain(env, steps);
    const checks = [
      { check: "two_stage_calls", ok: env.provider.responses === 2 },
      { check: "catalogue_landed", ok: pass.marks.length === 1 },
      { check: "failed_stage_shows_nothing", ok: pass.blooms.length === 0 && completed.stages?.connect === "provider_stage_failed" },
      { check: "pass_complete", ok: pass.status === "complete" },
      noFiles(env),
    ];
    return { name: "sync_tend_connect", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_timeout_mid_call", async () => {
    const env = syncEnvironment();
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    let calls = 0;
    env.provider.onRespond = () => {
      calls += 1;
      if (calls > 1) return null;
      env.clock.advance(syncLimits.callTimeoutMs);
      throw timeout();
    };
    const timedOut = await step(env);
    steps.push({ state: timedOut.state, reason: timedOut.reason });
    const openAfterTimeout = pass.dispatchOpen && pass.actualCents === null;
    await drain(env, steps);
    const checks = [
      { check: "timeout_schedules_retry", ok: timedOut.state === "retry_scheduled" && timedOut.reason === "timeout" },
      { check: "dispatch_left_open_unsettled", ok: openAfterTimeout },
      { check: "second_dispatch_made", ok: pass.dispatches === 2 && env.provider.responses === 2 },
      { check: "lost_dispatch_booked_at_reservation", ok: pass.lostCents === PASS_ESTIMATE_CENTS },
      { check: "one_bloom_after_retry", ok: pass.blooms.length === 1 && pass.status === "complete" },
      { check: "reservation_released", ok: env.ledger.reservedCents === 0 },
      noFiles(env),
    ];
    return { name: "sync_timeout_mid_call", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_timeouts_exhaust_dispatch_limit", async () => {
    const env = syncEnvironment();
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    env.provider.onRespond = () => {
      throw timeout();
    };
    await drain(env, steps);
    const states = steps.map(({ state }) => state);
    const checks = [
      { check: "three_dispatches_then_stop", ok: pass.dispatches === 3 && env.provider.responses === 3 },
      { check: "pass_failed", ok: pass.status === "failed" && states.includes("failed") },
      { check: "nothing_stored", ok: pass.blooms.length === 0 },
      { check: "every_dispatch_charged", ok: env.ledger.spentCents === 3 * PASS_ESTIMATE_CENTS },
      { check: "reservation_released", ok: env.ledger.reservedCents === 0 },
      noFiles(env),
    ];
    return { name: "sync_timeouts_exhaust_dispatch_limit", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_lease_lost_after_answer", async () => {
    const env = syncEnvironment();
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    let calls = 0;
    env.provider.onRespond = () => {
      calls += 1;
      // The provider answers, but only after the lease has run out.
      if (calls === 1) env.clock.advance(syncLimits.leaseMs + 1000);
      return null;
    };
    const lost = await step(env);
    steps.push({ state: lost.state });
    const nothingStored = pass.blooms.length === 0 && pass.actualCents === null;
    await drain(env, steps);
    const checks = [
      { check: "lease_loss_is_reported", ok: lost.state === "lease_lost" },
      { check: "late_answer_not_stored", ok: nothingStored },
      { check: "redispatched_once", ok: pass.dispatches === 2 },
      { check: "lost_dispatch_booked_at_reservation", ok: pass.lostCents === PASS_ESTIMATE_CENTS },
      { check: "one_bloom_after_retry", ok: pass.blooms.length === 1 },
      noFiles(env),
    ];
    return { name: "sync_lease_lost_after_answer", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_duplicate_invocation", async () => {
    const env = syncEnvironment();
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    let duplicate = null;
    env.provider.onRespond = async () => {
      // A second worker is invoked while the first is waiting on the provider.
      if (!duplicate) duplicate = await step(env);
      return null;
    };
    const first = await step(env);
    steps.push({ state: first.state }, { state: duplicate?.state });
    await drain(env, steps);
    const checks = [
      { check: "duplicate_is_idle", ok: duplicate?.state === "idle" },
      { check: "first_completes", ok: first.state === "complete" },
      { check: "one_provider_call", ok: env.provider.responses === 1 },
      { check: "one_dispatch", ok: pass.dispatches === 1 },
      { check: "one_bloom_stored", ok: pass.blooms.length === 1 },
      noFiles(env),
    ];
    return { name: "sync_duplicate_invocation", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_budget_stop", async () => {
    // Room for exactly one reservation: a redispatch after a lost call cannot be booked.
    const env = syncEnvironment({ hardCapCents: PASS_ESTIMATE_CENTS + 1 });
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    let rejected = false;
    try {
      env.ledger.createPass("tenant-b");
    } catch (error) {
      rejected = error.message === "AI budget reached";
    }
    env.provider.onRespond = () => {
      throw timeout();
    };
    await drain(env, steps);
    const stopped = steps.find((item) => item.state === "failed");
    const checks = [
      { check: "second_pass_rejected_at_cap", ok: rejected },
      { check: "redispatch_refused_at_cap", ok: Boolean(stopped) && pass.dispatches === 1 },
      { check: "one_provider_call", ok: env.provider.responses === 1 },
      { check: "spend_within_hard_cap", ok: env.ledger.spentCents <= env.ledger.hardCapCents },
      { check: "reservation_released", ok: env.ledger.reservedCents === 0 },
      noFiles(env),
    ];
    return { name: "sync_budget_stop", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_cancel_in_flight", async () => {
    const env = syncEnvironment();
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    env.provider.onRespond = () => {
      env.ledger.cancelPass(pass);
      return null;
    };
    const cancelled = await step(env);
    steps.push({ state: cancelled.state });
    await drain(env, steps);
    const checks = [
      { check: "reported_cancelled", ok: cancelled.state === "cancelled" && pass.status === "cancelled" },
      { check: "answer_discarded", ok: pass.blooms.length === 0 },
      { check: "actual_usage_charged", ok: env.ledger.spentCents > 0 && env.ledger.spentCents < PASS_ESTIMATE_CENTS },
      { check: "reservation_released", ok: env.ledger.reservedCents === 0 },
      { check: "cleanup_pending_false", ok: pass.cleanupPending === false },
      noFiles(env),
    ];
    return { name: "sync_cancel_in_flight", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_provider_error", async () => {
    const env = syncEnvironment();
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    let calls = 0;
    env.provider.onRespond = () => (++calls === 1 ? refusal(503) : null);
    const retried = await step(env);
    steps.push({ state: retried.state, reason: retried.reason });
    const uncharged = env.ledger.spentCents === 0 && pass.dispatchOpen === false;
    await drain(env, steps);
    const permanent = syncEnvironment();
    const refused = permanent.ledger.createPass("tenant-a");
    permanent.provider.onRespond = () => refusal(400);
    const failed = await step(permanent);
    steps.push({ state: failed.state, reason: failed.reason });
    const checks = [
      { check: "retryable_error_schedules_retry", ok: retried.state === "retry_scheduled" && retried.reason === "provider_error" },
      { check: "refused_dispatch_not_charged", ok: uncharged && pass.lostCents === 0 },
      { check: "completes_on_retry", ok: pass.status === "complete" && pass.blooms.length === 1 },
      { check: "permanent_error_fails", ok: failed.state === "failed" && refused.status === "failed" && refused.blooms.length === 0 },
      noFiles(env),
      noFiles(permanent),
    ];
    return { name: "sync_provider_error", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_oversized_snapshot", async () => {
    const env = syncEnvironment();
    const steps = [];
    const big = [{ ...fixture[0], body: "x".repeat(syncLimits.requestBytes) }];
    const pass = env.ledger.createPass("tenant-a", big);
    const failed = await step(env);
    steps.push({ state: failed.state, reason: failed.reason });
    await drain(env, steps);
    const checks = [
      { check: "failed_before_dispatch", ok: failed.state === "failed" && failed.reason === "oversized_snapshot" },
      { check: "no_provider_call", ok: env.provider.responses === 0 && pass.dispatches === 0 },
      { check: "reservation_released", ok: env.ledger.reservedCents === 0 },
      noFiles(env),
    ];
    return { name: "sync_oversized_snapshot", steps, checks, ok: checks.every((c) => c.ok) };
  }),
  scenario("sync_function_time_limit", async () => {
    const env = syncEnvironment();
    const steps = [];
    const pass = env.ledger.createPass("tenant-a");
    // The ledger is slow: by the time the job is in hand, too little of the invocation is left.
    const rpc = env.ledger.rpc.bind(env.ledger);
    let slow = true;
    env.ledger.rpc = async (name, args) => {
      const result = await rpc(name, args);
      if (slow && name === "claim_garden_pass" && result) {
        slow = false;
        env.clock.advance(60_000);
      }
      return result;
    };
    const deferred = await step(env);
    steps.push({ state: deferred.state, reason: deferred.reason });
    const untouched = env.provider.responses === 0 && pass.dispatches === 0;
    await drain(env, steps);
    const checks = [
      { check: "deferred_without_dispatch", ok: deferred.state === "deferred" && untouched },
      { check: "completes_on_a_later_tick", ok: pass.status === "complete" && env.provider.responses === 1 },
      {
        check: "call_fits_lease_and_function_limit",
        ok:
          syncLimits.callTimeoutMs + syncLimits.settleMarginMs <= syncLimits.leaseMs &&
          syncLimits.leaseMs <= syncLimits.invocationBudgetMs &&
          syncLimits.invocationBudgetMs < 150_000,
      },
      noFiles(env),
    ];
    return { name: "sync_function_time_limit", steps, checks, ok: checks.every((c) => c.ok) };
  }),
);

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
        sync_calls: providers.reduce((total, provider) => total + provider.responses, 0),
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
