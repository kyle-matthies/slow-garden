import test from "node:test";
import assert from "node:assert/strict";
import {
  validateReturn,
  parseBatchLine,
  runOne,
  requestFor,
} from "../../supabase/functions/_shared/garden-runtime.mjs";
const snapshot = [
  {
    revision_id: "r1",
    body: "I keep returning to a quieter workspace.",
    seed_id: "s1",
    plot_id: "p1",
  },
];
const bloom = {
  kind: "question",
  interpretation: "What draws you back to a quieter workspace?",
  evidence: [{ revision_id: "r1", excerpt: "a quieter workspace" }],
};
const valid = { blooms: [bloom], no_output_reason: null };
test("valid reflection and no-output are accepted", () => {
  assert.deepEqual(validateReturn(valid, snapshot), valid);
  assert.deepEqual(
    validateReturn({ blooms: [], no_output_reason: "Unchanged" }, snapshot)
      .blooms,
    [],
  );
});
for (const [name, output] of [
  [
    "more than three blooms",
    { ...valid, blooms: [bloom, bloom, bloom, bloom] },
  ],
  [
    "unknown source",
    {
      ...valid,
      blooms: [
        {
          ...bloom,
          evidence: [
            { revision_id: "outside", excerpt: "a quieter workspace" },
          ],
        },
      ],
    },
  ],
  [
    "invented quotation",
    {
      ...valid,
      blooms: [
        {
          ...bloom,
          evidence: [{ revision_id: "r1", excerpt: "a louder workspace" }],
        },
      ],
    },
  ],
  ["missing evidence", { ...valid, blooms: [{ ...bloom, evidence: [] }] }],
  ["tool fields", { ...valid, tool_call: "send_email" }],
  [
    "diagnostic certainty",
    {
      ...valid,
      blooms: [{ ...bloom, interpretation: "You have depression." }],
    },
  ],
])
  test("reject " + name, () =>
    assert.throws(() => validateReturn(output, snapshot)),
  );
test("provider output must belong to this pass and contain only completed text", () => {
  const line = {
    custom_id: "job",
    response: {
      status_code: 200,
      body: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(valid) }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    },
  };
  assert.equal(
    parseBatchLine(JSON.stringify(line), { id: "job", snapshot }).inputTokens,
    100,
  );
  assert.throws(() =>
    parseBatchLine(JSON.stringify(line), { id: "other", snapshot }),
  );
  line.response.body.output.push({ type: "function_call" });
  assert.throws(() =>
    parseBatchLine(JSON.stringify(line), { id: "job", snapshot }),
  );
});
function harness(job, overrides = {}) {
  const calls = [];
  const providerCalls = [];
  const { now = Date.now, rpc: rpcOverride, ...providerOverrides } = overrides;
  const defaults = {
    upload: async () => "file",
    createBatch: async () => "batch",
    getBatch: async () => ({ status: "in_progress" }),
    cancelBatch: async () => {},
    download: async () => "",
    deleteFile: async () => {},
  };
  const provider = Object.fromEntries(
    Object.entries(defaults).map(([name, fallback]) => [
      name,
      async (...args) => {
        providerCalls.push([name, ...args]);
        return (providerOverrides[name] ?? fallback)(...args);
      },
    ]),
  );
  return {
    calls,
    providerCalls,
    now,
    rpc:
      rpcOverride ??
      (async (name, args) => {
        calls.push([name, args]);
        if (name === "claim_garden_pass") return job;
        if (name === "check_garden_pass") return true;
      }),
    provider,
  };
}
test("manual dispatch uploads frozen input once and records provider ID", async () => {
  const h = harness({
    id: "j",
    token: "t",
    status: "queued",
    snapshot,
    model: "pinned",
    created_at: new Date().toISOString(),
  });
  assert.equal((await runOne(h)).state, "submitted");
  assert.equal(h.calls.filter((c) => c[0] === "update_garden_job").length, 2);
});
test("reconciliation never resubmits an existing provider job", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "processing",
      provider_id: "b",
      created_at: new Date().toISOString(),
    },
    {
      upload: () => assert.fail("duplicate upload"),
      createBatch: () => assert.fail("duplicate batch"),
    },
  );
  assert.equal((await runOne(h)).state, "waiting");
});
test("revoked dispatch never contacts provider", async () => {
  const h = harness({ id: "j", token: "t", status: "queued" });
  const original = h.rpc;
  h.rpc = async (n, a) => (n === "check_garden_pass" ? false : original(n, a));
  assert.equal((await runOne(h)).state, "cancelled");
  assert.ok(h.calls.some((c) => c[0] === "finish_garden_pass"));
});
test("cancellation waits for terminal provider evidence before deleting files", async () => {
  let deleted = false,
    cancelled = false;
  const h = harness(
    { id: "j", token: "t", status: "cancelled", provider_id: "b" },
    {
      deleteFile: () => {
        deleted = true;
      },
      cancelBatch: () => {
        cancelled = true;
      },
    },
  );
  assert.equal((await runOne(h)).state, "cancelling");
  assert.equal(deleted, false);
  assert.equal(cancelled, true);
});
test("settled cancellation can finish cleanup instead of looping", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "cancelled",
      provider_id: "b",
      settled: true,
    },
    { getBatch: async () => ({ status: "cancelled" }) },
  );
  assert.equal((await runOne(h)).state, "cleaned");
  assert.ok(h.calls.some((c) => c[1]?.p_clean === true));
});
test("request is tool-free, pins model, and includes only supplied context", () => {
  const request = requestFor({
    id: "j",
    model: "snapshot",
    workflow_version: "v2",
    snapshot,
    corrections: [],
  });
  assert.equal(request.body.model, "snapshot");
  assert.equal(request.body.store, false);
  assert.equal(request.body.tools, undefined);
  assert.equal(JSON.parse(request.body.input[1].content).sources.length, 1);
});

const completedLine = (id, result = valid) =>
  JSON.stringify({
    custom_id: id,
    response: {
      status_code: 200,
      body: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(result) }],
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    },
  });
const oldCreatedAt = () => new Date(Date.now() - 31 * 60 * 60 * 1000).toISOString();

test("expired pass with a live provider batch is cancelled before it is failed", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "processing",
      provider_id: "b",
      created_at: oldCreatedAt(),
    },
    { getBatch: async () => ({ status: "in_progress" }) },
  );
  const result = await runOne(h);
  assert.deepEqual(result, { state: "expired", reason: "deadline" });
  assert.deepEqual(
    h.providerCalls.map(([name, ...args]) => [name, ...args]),
    [
      ["getBatch", "b"],
      ["cancelBatch", "b"],
    ],
  );
  assert.deepEqual(
    h.calls.map(([name, args]) => [name, args]),
    [
      ["claim_garden_pass", {}],
      ["check_garden_pass", { p_id: "j", p_token: "t" }],
      [
        "finish_garden_pass",
        {
          p_id: "j",
          p_token: "t",
          p_result: { blooms: [], no_output_reason: null },
          p_failed: true,
        },
      ],
    ],
  );
});

test("expired pass does not re-cancel a terminal or cancelling batch", async () => {
  for (const batch of [
    { status: "completed", output_file_id: "o" },
    { status: "cancelling" },
  ]) {
    const h = harness(
      {
        id: "j",
        token: "t",
        status: "processing",
        provider_id: "b",
        created_at: oldCreatedAt(),
      },
      { getBatch: async () => batch },
    );
    assert.deepEqual(await runOne(h), { state: "expired", reason: "deadline" });
    assert.deepEqual(h.providerCalls.map(([name]) => name), ["getBatch"]);
    assert.equal(
      h.providerCalls.some(([name]) => name === "download"),
      false,
    );
  }
});

test("expired pass without provider work is failed without contacting provider", async () => {
  const h = harness(
    { id: "j", token: "t", status: "queued", created_at: oldCreatedAt() },
    {
      getBatch: () => assert.fail("getBatch should not run"),
      cancelBatch: () => assert.fail("cancelBatch should not run"),
    },
  );
  assert.deepEqual(await runOne(h), { state: "expired", reason: "deadline" });
  assert.deepEqual(h.providerCalls, []);
  assert.equal(h.calls.at(-1)[0], "finish_garden_pass");
  assert.equal(h.calls.at(-1)[1].p_failed, true);
});

test("provider-expired batch fails the pass and leaves files for cleanup", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "processing",
      provider_id: "b",
      created_at: new Date().toISOString(),
    },
    {
      getBatch: async () => ({ status: "expired", output_file_id: "o" }),
      deleteFile: () => assert.fail("cleanup must wait for a later claim"),
    },
  );
  assert.deepEqual(await runOne(h), { state: "expired", reason: "provider" });
  assert.deepEqual(h.providerCalls.map(([name]) => name), ["getBatch"]);
  assert.equal(h.calls.at(-1)[0], "finish_garden_pass");
  assert.equal(h.calls.at(-1)[1].p_failed, true);
});

test("cleanup after provider expiry deletes every provider file once", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "failed",
      provider_id: "b",
      input_file_id: "in",
      output_file_id: "out",
      settled: true,
    },
    {
      getBatch: async () => ({
        status: "expired",
        output_file_id: "out",
        error_file_id: "err",
      }),
    },
  );
  assert.deepEqual(await runOne(h), { state: "cleaned" });
  const deleted = h.providerCalls
    .filter(([name]) => name === "deleteFile")
    .map(([, id]) => id);
  assert.deepEqual(deleted, ["out", "err", "in", "out"]);
  assert.deepEqual(new Set(deleted), new Set(["in", "out", "err"]));
  assert.deepEqual(h.calls.at(-1), [
    "update_garden_job",
    {
      p_id: "j",
      p_token: "t",
      p_clean: true,
      p_release: true,
    },
  ]);
});

test("duplicate result lines are rejected", () => {
  const line = completedLine("job");
  assert.throws(
    () => parseBatchLine(`${line}\n${line}`, { id: "job", snapshot }),
    /duplicate_provider_result/,
  );
  assert.doesNotThrow(() =>
    parseBatchLine(`${line}\n\n`, { id: "job", snapshot }),
  );
});

test("a settled pass is never re-finished or re-downloaded", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "complete",
      provider_id: "b",
      output_file_id: "o",
      settled: true,
    },
    {
      getBatch: async () => ({ status: "completed", output_file_id: "o" }),
      download: () => assert.fail("settled cleanup must not download"),
    },
  );
  assert.deepEqual(await runOne(h), { state: "cleaned" });
  assert.equal(h.calls.some(([name]) => name === "finish_garden_pass"), false);
  assert.deepEqual(h.providerCalls.map(([name]) => name), [
    "getBatch",
    "deleteFile",
    "deleteFile",
  ]);
});

test("lost lease during completion writes nothing further", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "processing",
      provider_id: "b",
      created_at: new Date().toISOString(),
      snapshot,
    },
    {
      getBatch: async () => ({ status: "completed", output_file_id: "o" }),
      download: async () => completedLine("j"),
    },
  );
  const original = h.rpc;
  h.rpc = async (name, args) => {
    if (name === "update_garden_job") throw Error("lease lost");
    return original(name, args);
  };
  assert.deepEqual(await runOne(h), { state: "lease_lost" });
  assert.equal(h.calls.some(([name]) => name === "finish_garden_pass"), false);
  assert.deepEqual(h.providerCalls.map(([name]) => name), [
    "getBatch",
  ]);
});

test("lost lease on the failure path does not throw", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "processing",
      provider_id: "b",
      created_at: new Date().toISOString(),
    },
    {
      getBatch: async () => {
        throw Error("boom");
      },
    },
  );
  const original = h.rpc;
  h.rpc = async (name, args) => {
    if (name === "finish_garden_pass") throw Error("lease lost");
    return original(name, args);
  };
  assert.deepEqual(await runOne(h), { state: "lease_lost" });
});

test("retryable provider error releases the lease up to five attempts", async () => {
  for (const attempts of [1, 5]) {
    const error = Error("temporary");
    error.retryable = true;
    const h = harness(
      {
        id: "j",
        token: "t",
        status: "processing",
        provider_id: "b",
        attempts,
        created_at: new Date().toISOString(),
      },
      { getBatch: async () => Promise.reject(error) },
    );
    assert.deepEqual(
      await runOne(h),
      attempts === 1
        ? { state: "retry_scheduled" }
        : { state: "failed" },
    );
    const last = h.calls.at(-1);
    assert.equal(last[0], attempts === 1 ? "update_garden_job" : "finish_garden_pass");
    assert.equal(last[1][attempts === 1 ? "p_release" : "p_failed"], true);
  }
});

test("cleanup does not re-cancel a batch already cancelling", async () => {
  const h = harness(
    {
      id: "j",
      token: "t",
      status: "cancelled",
      provider_id: "b",
    },
    {
      getBatch: async () => ({ status: "cancelling" }),
      cancelBatch: () => assert.fail("already cancelling"),
    },
  );
  assert.deepEqual(await runOne(h), { state: "cancelling" });
  assert.deepEqual(h.providerCalls.map(([name]) => name), ["getBatch"]);
  assert.deepEqual(h.calls.at(-1), [
    "update_garden_job",
    {
      p_id: "j",
      p_token: "t",
      p_release: true,
    },
  ]);
});

/* ---------------- tend-connect-v3 (ADR-008) ---------------- */
import {
  allowedKinds,
  parseTendConnect,
  requestsFor,
  validateConnect,
  validateTend,
} from "../../supabase/functions/_shared/garden-runtime.mjs";

const v3Snapshot = [
  { revision_id: "r1", seed_id: "s1", title: "Room", body: "Leaving room before naming the solution.", created_at: "2026-05-01T00:00:00Z", role: "changed" },
  { revision_id: "r2", seed_id: "s1", title: "Room", body: "Is the room before naming really empty?", created_at: "2026-10-01T00:00:00Z", role: "changed" },
  { revision_id: "r3", seed_id: "s2", title: "Walks", body: "A slow walk made room for the question.", created_at: "2026-02-01T00:00:00Z", role: "candidate" },
];
const v3Job = (tiers) => ({
  id: "pass",
  model: "pinned-model",
  workflow_version: "tend-connect-v3",
  snapshot: v3Snapshot,
  corrections: [{ pruned: "theme", label: "naming" }],
  context: { tiers: { catalog: true, ...tiers }, index: [{ seed_id: "s1", title: "Room", labels: [] }] },
});
const stageLine = (stage, value, extra = {}) =>
  JSON.stringify({
    custom_id: `pass:${stage}`,
    response: {
      status_code: 200,
      body: {
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    },
    ...extra,
  });

test("v3 requests: tend always, connect only when a tier unlocks it", () => {
  const catalogOnly = requestsFor(v3Job({ notice: false, resurface: false }));
  assert.deepEqual(catalogOnly.map((l) => l.custom_id), ["pass:tend"]);
  const tendInput = JSON.parse(catalogOnly[0].body.input[1].content);
  assert.deepEqual(tendInput.sources.map((s) => s.revision_id), ["r1", "r2"], "tend sees only changed writing");
  assert.ok(tendInput.sources.every((s) => s.role === "changed"), "tend sources carry the role required by the prompt");
  assert.deepEqual(tendInput.corrections, [{ pruned: "theme", label: "naming" }]);
  const full = requestsFor(v3Job({ notice: true, resurface: true }));
  assert.deepEqual(full.map((l) => l.custom_id), ["pass:tend", "pass:connect"]);
  for (const line of full) {
    assert.equal(line.body.model, "pinned-model");
    assert.equal(line.body.store, false);
    assert.equal(line.body.tools, undefined);
    assert.equal(line.body.text.format.strict, true);
  }
  const connect = full[1].body;
  assert.deepEqual(connect.text.format.schema.properties.blooms.items.properties.kind.enum, allowedKinds({ notice: true, resurface: true }));
  assert.equal(connect.text.format.schema.properties.blooms.items.properties.interpretation.maxLength, 280);
  assert.deepEqual(requestsFor(v3Job({ notice: false, resurface: true }))[1].body.text.format.schema.properties.blooms.items.properties.kind.enum, ["echo", "question"]);
});

test("v3 tend keeps exact, capped, plain marks and drops the rest", () => {
  const job = v3Job({});
  const ev = (revision_id, excerpt) => ({ revision_id, excerpt });
  const { marks, dropped } = validateTend(
    {
      marks: [
        { seed_id: "s1", kind: "theme", label: " room ", evidence: [ev("r1", "Leaving room")] },
        { seed_id: "s1", kind: "theme", label: "naming", evidence: [ev("r2", "naming")] },
        { seed_id: "s1", kind: "theme", label: "third", evidence: [ev("r1", "solution")] },
        { seed_id: "s1", kind: "open_question", label: "ignored", evidence: [ev("r2", "Is the room before naming really empty?")] },
        { seed_id: "s1", kind: "theme", label: "anxiety", evidence: [ev("r1", "room")] },
        { seed_id: "s2", kind: "theme", label: "walks", evidence: [ev("r3", "A slow walk")] },
        { seed_id: "s1", kind: "theme", label: "made up", evidence: [ev("r1", "words that are not there")] },
        { seed_id: "s1", kind: "unfinished", label: "", evidence: [ev("r3", "made room")] },
      ],
    },
    job,
  );
  assert.deepEqual(
    marks.map((m) => [m.kind, m.label]),
    [
      ["theme", "room"],
      ["theme", "naming"],
      ["open_question", ""],
    ],
  );
  assert.equal(dropped, 5, "over-cap, clinical, candidate-only, invented and cross-thought marks are dropped");
  assert.throws(() => validateTend({ marks: [], extra: 1 }, job));
});

test("v3 connect is strict: allowed kinds, one short sentence, real evidence", () => {
  const job = v3Job({ notice: true, resurface: false });
  const echo = {
    kind: "echo",
    interpretation: "An older walk sits beside this week's question about room.",
    evidence: [
      { revision_id: "r3", excerpt: "made room" },
      { revision_id: "r2", excerpt: "the room before naming" },
    ],
  };
  assert.throws(() => validateConnect({ blooms: [echo], no_output_reason: null }, job), /invalid_bloom/, "echo needs the resurface tier");
  const job3 = v3Job({ notice: true, resurface: true });
  assert.equal(validateConnect({ blooms: [echo], no_output_reason: null }, job3).blooms.length, 1);
  const twoSentences = { ...echo, interpretation: "First thought here. Second thought there." };
  assert.throws(() => validateConnect({ blooms: [twoSentences], no_output_reason: null }, job3), /invalid_bloom/);
  const oldOnly = { ...echo, evidence: [echo.evidence[0], { revision_id: "r3", excerpt: "A slow walk" }] };
  assert.throws(() => validateConnect({ blooms: [oldOnly], no_output_reason: null }, job3), /invalid_echo/, "an echo cites current writing");
  const recentPair = {
    ...echo,
    evidence: [
      { revision_id: "r2", excerpt: "the room before naming" },
      { revision_id: "r2", excerpt: "really empty" },
    ],
  };
  assert.throws(() => validateConnect({ blooms: [recentPair], no_output_reason: null }, job3), /invalid_echo/, "an echo spans at least four weeks");
  const lonelyEcho = { ...echo, evidence: [echo.evidence[0]] };
  assert.throws(() => validateConnect({ blooms: [lonelyEcho], no_output_reason: null }, job3), /invalid_bloom/);
  const q = { kind: "question", interpretation: "What is the room for?", evidence: [{ revision_id: "r2", excerpt: "room" }] };
  assert.throws(() => validateConnect({ blooms: [q, q], no_output_reason: null }, job3), /too_many_questions/);
  assert.throws(
    () => validateConnect({ blooms: [{ ...q, interpretation: "You have depression?" }], no_output_reason: null }, job3),
    /overreach/,
  );
});

test("v3 stages land independently; nothing survives means failure", () => {
  const job = v3Job({ notice: true, resurface: true });
  const tend = { marks: [{ seed_id: "s1", kind: "theme", label: "room", evidence: [{ revision_id: "r1", excerpt: "room" }] }] };
  const badConnect = { blooms: [{ kind: "echo", interpretation: "x", evidence: [] }], no_output_reason: null };
  const partial = parseTendConnect([stageLine("tend", tend), stageLine("connect", badConnect)].join("\n"), job);
  assert.equal(partial.result.marks.length, 1);
  assert.deepEqual(partial.result.blooms, []);
  assert.equal(partial.stages.tend, "ok");
  assert.equal(partial.stages.connect, "invalid_bloom");
  assert.equal(partial.inputTokens, 200);
  const missing = parseTendConnect(stageLine("tend", tend), job);
  assert.equal(missing.stages.connect, "missing");
  assert.throws(() => parseTendConnect(stageLine("connect", badConnect), job), /no_valid_stage/);
  assert.throws(() => parseTendConnect([stageLine("tend", tend), stageLine("tend", tend)].join("\n"), job), /duplicate/);
  assert.throws(() => parseTendConnect(stageLine("other", tend), job), /mismatch/);
  const catalogOnly = v3Job({});
  assert.throws(() => parseTendConnect([stageLine("tend", tend), stageLine("connect", badConnect)].join("\n"), catalogOnly), /mismatch/, "no connect line was requested");
});

test("v3 dispatch uploads both stage lines and finishes with marks", async () => {
  const job = { ...v3Job({ notice: true, resurface: true }), token: "t", status: "queued", attempts: 1, created_at: new Date().toISOString() };
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === "claim_garden_pass") return calls.filter(([n]) => n === "claim_garden_pass").length === 1 ? job : { ...job, provider_id: "batch", input_file_id: "file" };
    if (name === "check_garden_pass") return true;
    return null;
  };
  let uploaded = "";
  const provider = {
    upload: async (text) => ((uploaded = text), "file"),
    createBatch: async () => "batch",
    getBatch: async () => ({ status: "completed", output_file_id: "out" }),
    download: async () =>
      [
        stageLine("tend", { marks: [{ seed_id: "s1", kind: "theme", label: "room", evidence: [{ revision_id: "r1", excerpt: "room" }] }] }),
        stageLine("connect", { blooms: [], no_output_reason: "Nothing new to add." }),
      ].join("\n"),
  };
  assert.equal((await runOne({ rpc, provider })).state, "submitted");
  assert.deepEqual(uploaded.trim().split("\n").map((l) => JSON.parse(l).custom_id), ["pass:tend", "pass:connect"]);
  const done = await runOne({ rpc, provider });
  assert.equal(done.state, "complete");
  assert.deepEqual(done.stages, { tend: "ok", connect: "ok" });
  const finish = calls.find(([n]) => n === "finish_garden_pass")[1];
  assert.equal(finish.p_result.marks.length, 1);
  assert.equal(finish.p_input_tokens, 200);
  assert.ok(!JSON.stringify(done).includes("room"), "the worker's report carries no source text");
});

test("v3 ignores reasoning metadata but still rejects tool calls", () => {
  const job = v3Job({});
  const line = JSON.parse(stageLine("tend", { marks: [] }));
  line.response.body.output.unshift({ type: "reasoning", summary: [] });
  assert.equal(parseTendConnect(JSON.stringify(line), job).stages.tend, "ok");
  line.response.body.output.push({ type: "function_call", name: "unexpected_tool" });
  assert.throws(() => parseTendConnect(JSON.stringify(line), job), /no_valid_stage/);
});

// Provider orphans: cleanup that outlives a deleted pass (runbook gap 3.9).
import { drainOrphan } from "../../supabase/functions/_shared/garden-runtime.mjs";
function orphanHarness(orphan, overrides = {}) {
  const h = harness(null, overrides);
  h.rpc = async (name, args) => {
    h.calls.push([name, args]);
    if (name === "claim_provider_orphan") return orphan;
    return null;
  };
  return h;
}
test("an idle worker with no orphans stays idle", async () => {
  const h = orphanHarness(null);
  assert.deepEqual(await runOne(h), { state: "idle" });
  assert.deepEqual(
    h.calls.map(([name]) => name),
    ["claim_garden_pass", "claim_provider_orphan"],
  );
  assert.equal(h.providerCalls.length, 0);
});
test("an orphan queue that cannot be read is reported, not mistaken for idle", async () => {
  const h = orphanHarness(null);
  h.rpc = async (name) => {
    if (name === "claim_provider_orphan") throw new Error("PGRST202");
    return null;
  };
  assert.deepEqual(await runOne(h), { state: "orphan_queue_unavailable" });
  assert.equal(h.providerCalls.length, 0);
});
const notFound = () => Object.assign(new Error("provider_request_failed"), { status: 404 });
test("an orphan the provider no longer knows is already deleted", async () => {
  const h = orphanHarness(
    { id: "o", token: "t", provider_id: "b", input_file_id: "in", output_file_id: "out" },
    {
      getBatch: async () => {
        throw notFound();
      },
      deleteFile: async () => {
        throw notFound();
      },
    },
  );
  assert.deepEqual(await drainOrphan(h), { state: "orphan_cleaned" });
  assert.deepEqual(h.calls.at(-1)[1], { p_id: "o", p_token: "t", p_done: true });
});
test("a pass deleted after upload has its file removed from the in-memory id", async () => {
  const h = harness({ id: "j", token: "t", status: "processing", snapshot, created_at: new Date().toISOString(), attempts: 1 });
  const original = h.rpc;
  h.rpc = async (name, args) => {
    if (name === "update_garden_job") throw new Error("lease lost");
    return original(name, args);
  };
  assert.deepEqual(await runOne(h), { state: "lease_lost" });
  assert.deepEqual(h.providerCalls.map(([name, id]) => [name, name === "upload" ? "" : id]), [
    ["upload", ""],
    ["deleteFile", "file"],
  ]);
});
test("a pass deleted after batch creation has its batch cancelled and its file removed", async () => {
  const h = harness({ id: "j", token: "t", status: "processing", snapshot, created_at: new Date().toISOString(), attempts: 1 });
  const original = h.rpc;
  h.rpc = async (name, args) => {
    if (name === "update_garden_job" && args.p_provider) throw new Error("lease lost");
    return original(name, args);
  };
  assert.deepEqual(await runOne(h), { state: "lease_lost" });
  assert.deepEqual(
    h.providerCalls.map(([name]) => name),
    ["upload", "createBatch", "cancelBatch", "deleteFile"],
  );
  assert.deepEqual(h.providerCalls.at(-2), ["cancelBatch", "batch"]);
  assert.deepEqual(h.providerCalls.at(-1), ["deleteFile", "file"]);
});
test("cleanup of an unrecorded batch never masks the lost lease", async () => {
  const h = harness(
    { id: "j", token: "t", status: "processing", snapshot, created_at: new Date().toISOString(), attempts: 1 },
    {
      cancelBatch: async () => {
        throw new Error("provider_request_failed");
      },
    },
  );
  const original = h.rpc;
  h.rpc = async (name, args) => {
    if (name === "update_garden_job" && args.p_provider) throw new Error("lease lost");
    return original(name, args);
  };
  assert.deepEqual(await runOne(h), { state: "lease_lost" });
  assert.deepEqual(h.providerCalls.at(-1), ["deleteFile", "file"]);
});
test("an orphan with a terminal batch has every file deleted, then is resolved", async () => {
  const h = orphanHarness(
    {
      id: "o",
      token: "t",
      provider_id: "b",
      input_file_id: "in",
      output_file_id: null,
    },
    {
      getBatch: async () => ({
        status: "completed",
        output_file_id: "out",
        error_file_id: "err",
      }),
    },
  );
  assert.deepEqual(await runOne(h), { state: "orphan_cleaned" });
  assert.deepEqual(
    h.providerCalls.filter(([name]) => name === "deleteFile").map(([, id]) => id),
    ["out", "err", "in"],
  );
  assert.deepEqual(h.calls.at(-1), [
    "resolve_provider_orphan",
    { p_id: "o", p_token: "t", p_done: true },
  ]);
});
test("an orphan whose batch is still running is cancelled and kept, with no file deleted", async () => {
  const h = orphanHarness({
    id: "o",
    token: "t",
    provider_id: "b",
    input_file_id: "in",
    output_file_id: null,
  });
  assert.deepEqual(await drainOrphan(h), { state: "orphan_cancelling" });
  assert.deepEqual(
    h.providerCalls.map(([name]) => name),
    ["getBatch", "cancelBatch"],
  );
  assert.deepEqual(h.calls.at(-1)[1], { p_id: "o", p_token: "t", p_done: false });
});
test("an orphan with only an uploaded file needs no batch lookup", async () => {
  const h = orphanHarness({
    id: "o",
    token: "t",
    provider_id: null,
    input_file_id: "in",
    output_file_id: null,
  });
  assert.deepEqual(await drainOrphan(h), { state: "orphan_cleaned" });
  assert.deepEqual(h.providerCalls, [["deleteFile", "in"]]);
});
test("a provider failure keeps the orphan queued", async () => {
  const h = orphanHarness(
    {
      id: "o",
      token: "t",
      provider_id: null,
      input_file_id: "in",
      output_file_id: "out",
    },
    {
      deleteFile: async () => {
        throw new Error("provider_request_failed");
      },
    },
  );
  assert.deepEqual(await drainOrphan(h), { state: "orphan_retry" });
  assert.deepEqual(h.calls.at(-1)[1], { p_id: "o", p_token: "t", p_done: false });
});
test("a lost orphan lease writes nothing further", async () => {
  const h = orphanHarness({
    id: "o",
    token: "t",
    provider_id: null,
    input_file_id: "in",
    output_file_id: null,
  });
  const original = h.rpc;
  h.rpc = async (name, args) => {
    if (name === "resolve_provider_orphan") throw new Error("lease lost");
    return original(name, args);
  };
  assert.deepEqual(await drainOrphan(h), { state: "lease_lost" });
});

/* ---- Synchronous transport ------------------------------------------------ */
import {
  syncLimits,
  httpProvider,
} from "../../supabase/functions/_shared/garden-runtime.mjs";

const answer = (value, usage = { input_tokens: 100, output_tokens: 40 }) => ({
  status_code: 200,
  retryable: false,
  body: {
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] },
    ],
    usage,
  },
});
const refusal = (status) => ({ status_code: status, body: null, retryable: status === 429 || status >= 500 });
const timeoutError = () => Object.assign(new Error("provider_request_failed"), { timeout: true });
const syncJob = (extra = {}) => ({
  id: "j",
  token: "t",
  status: "processing",
  transport: "sync",
  dispatches: 0,
  attempts: 1,
  snapshot,
  model: "pinned",
  workflow_version: "connect-v2",
  created_at: new Date().toISOString(),
  ...extra,
});
const v3SyncJob = (tiers = { catalog: true, notice: true, resurface: false }) =>
  syncJob({
    workflow_version: "tend-connect-v3",
    snapshot: snapshot.map((s) => ({ ...s, title: "Workspace", role: "changed", created_at: "2026-03-01T00:00:00.000Z" })),
    context: { tiers },
  });
const tendOk = {
  marks: [{ seed_id: "s1", kind: "theme", label: "workspace", evidence: [{ revision_id: "r1", excerpt: "a quieter workspace" }] }],
};
// A ledger stub that records calls and lets a test script each RPC.
function syncHarness(job, { respond, ledger = {}, now } = {}) {
  const calls = [];
  const responds = [];
  let active = true;
  const h = {
    calls,
    responds,
    deactivate: () => (active = false),
    now,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (ledger[name]) return ledger[name](args, calls);
      if (name === "claim_garden_pass") return job;
      if (name === "check_garden_pass") return active;
      if (name === "mark_garden_dispatch") return args.p_rejected ? "closed" : "ok";
      return null;
    },
    provider: {
      upload: () => assert.fail("sync never uploads a file"),
      createBatch: () => assert.fail("sync never creates a batch"),
      getBatch: () => assert.fail("sync never polls a batch"),
      cancelBatch: () => assert.fail("sync never cancels a batch"),
      download: () => assert.fail("sync never downloads a file"),
      deleteFile: () => assert.fail("sync has no file to delete"),
      respond: async (body, options) => {
        responds.push([body, options]);
        return respond(body, options, h);
      },
    },
  };
  if (!now) delete h.now;
  return h;
}
const names = (h) => h.calls.map(([name]) => name);
const finishArgs = (h) => h.calls.find(([name]) => name === "finish_garden_pass")?.[1];

test("sync limits keep a provider call inside its lease and the lease inside the function limit", () => {
  // ASSUMPTION recorded in the runtime: an Edge Function must answer within 150 seconds.
  const assumedEdgeLimitMs = 150_000;
  assert.ok(syncLimits.callTimeoutMs + syncLimits.settleMarginMs <= syncLimits.leaseMs);
  assert.ok(syncLimits.leaseMs <= syncLimits.invocationBudgetMs);
  assert.ok(syncLimits.invocationBudgetMs < assumedEdgeLimitMs);
});
test("sync: one call, no files, validated result settled with real usage", async () => {
  const h = syncHarness(syncJob({ reasoning_effort: "low" }), { respond: async () => answer(valid) });
  assert.deepEqual(await runOne(h), { state: "complete", transport: "sync" });
  assert.equal(h.responds.length, 1);
  const [body, options] = h.responds[0];
  assert.equal(body.store, false);
  assert.deepEqual(body.reasoning, { effort: "low" });
  assert.equal(body.tools, undefined);
  assert.equal(body.background, undefined);
  assert.equal(options.timeoutMs, syncLimits.callTimeoutMs);
  assert.equal(options.key, "garden-sync-j-1");
  assert.deepEqual(names(h), [
    "claim_garden_pass",
    "check_garden_pass",
    "mark_garden_dispatch",
    "check_garden_pass",
    "finish_garden_pass",
  ]);
  const finished = finishArgs(h);
  assert.deepEqual(finished.p_result, valid);
  assert.equal(finished.p_input_tokens, 100);
  assert.equal(finished.p_output_tokens, 40);
  assert.equal(finished.p_failed, undefined);
});
test("no reasoning effort pinned means the field is not sent", () => {
  assert.equal("reasoning" in requestFor(syncJob()).body, false);
  assert.equal("reasoning" in requestsFor(v3SyncJob())[0].body, false);
  assert.deepEqual(requestsFor({ ...v3SyncJob(), reasoning_effort: "low" })[1].body.reasoning, { effort: "low" });
});
test("connect-v2 parsing ignores reasoning metadata", () => {
  const line = JSON.stringify({ custom_id: "j", response: { status_code: 200, body: answer(valid).body } });
  assert.deepEqual(parseBatchLine(line, { id: "j", snapshot }).result, valid);
});
test("sync v3: stages run concurrently and land independently", async () => {
  const h = syncHarness(v3SyncJob(), {
    respond: async (body) =>
      body.text.format.name === "garden_tend" ? answer(tendOk) : refusal(500),
  });
  const result = await runOne(h);
  assert.equal(result.state, "complete");
  assert.equal(result.stages.tend, "ok");
  assert.equal(result.stages.connect, "provider_stage_failed");
  assert.equal(h.responds.length, 2);
  assert.deepEqual(h.responds.map(([, o]) => o.key), ["garden-sync-j:tend-1", "garden-sync-j:connect-1"]);
  assert.equal(finishArgs(h).p_result.marks.length, 1);
  assert.equal(finishArgs(h).p_input_tokens, 100);
});
test("sync: timeout mid-call leaves the dispatch open and schedules a retry", async () => {
  const h = syncHarness(syncJob(), {
    respond: async () => {
      throw timeoutError();
    },
  });
  assert.deepEqual(await runOne(h), { state: "retry_scheduled", reason: "timeout" });
  assert.equal(finishArgs(h), undefined, "usage is unknown, so the pass is not settled");
  assert.equal(h.calls.some(([n, a]) => n === "mark_garden_dispatch" && a.p_rejected), false);
  assert.deepEqual(h.calls.at(-1), ["update_garden_job", { p_id: "j", p_token: "t", p_release: true }]);
});
test("sync v3: one stage timing out discards the other stage's answer", async () => {
  const h = syncHarness(v3SyncJob(), {
    respond: async (body) => {
      if (body.text.format.name === "garden_tend") return answer(tendOk);
      throw timeoutError();
    },
  });
  assert.deepEqual(await runOne(h), { state: "retry_scheduled", reason: "timeout" });
  assert.equal(finishArgs(h), undefined);
});
test("sync: a broken connection is treated as unknown usage, like a timeout", async () => {
  const h = syncHarness(syncJob(), {
    respond: async () => {
      throw new Error("provider_request_failed");
    },
  });
  assert.deepEqual(await runOne(h), { state: "retry_scheduled", reason: "network" });
});
test("sync: lease lost after the provider answered stores nothing and never throws", async () => {
  const h = syncHarness(syncJob(), {
    respond: async () => answer(valid),
    ledger: {
      finish_garden_pass: () => {
        throw new Error("lease lost");
      },
    },
  });
  assert.deepEqual(await runOne(h), { state: "lease_lost" });
  assert.equal(names(h).filter((n) => n === "finish_garden_pass").length, 1, "no second write is attempted");
  assert.equal(names(h).includes("update_garden_job"), false);
});
test("sync: the redispatch after a lost answer uses a new key and is the ledger's decision", async () => {
  const h = syncHarness(syncJob({ dispatches: 1, attempts: 2 }), { respond: async () => answer(valid) });
  assert.equal((await runOne(h)).state, "complete");
  assert.equal(h.responds[0][1].key, "garden-sync-j-2");
});
test("sync: duplicate invocation while the first holds the lease does nothing", async () => {
  const h = syncHarness(null, { respond: () => assert.fail("no provider call"), ledger: { claim_provider_orphan: () => null } });
  assert.deepEqual(await runOne(h), { state: "idle" });
  assert.equal(h.responds.length, 0);
});
test("sync: budget stop at dispatch fails the pass without a provider call", async () => {
  const h = syncHarness(syncJob({ dispatches: 1 }), {
    respond: () => assert.fail("no provider call"),
    ledger: { mark_garden_dispatch: () => "budget" },
  });
  assert.deepEqual(await runOne(h), { state: "failed", reason: "budget_stop" });
  assert.equal(finishArgs(h).p_failed, true);
});
test("sync: the dispatch limit fails the pass without a provider call", async () => {
  const h = syncHarness(syncJob({ dispatches: 3 }), {
    respond: () => assert.fail("no provider call"),
    ledger: { mark_garden_dispatch: () => "limit" },
  });
  assert.deepEqual(await runOne(h), { state: "failed", reason: "dispatch_limit" });
});
test("sync: cancelled before dispatch never contacts the provider", async () => {
  const h = syncHarness(syncJob(), {
    respond: () => assert.fail("no provider call"),
    ledger: { mark_garden_dispatch: () => "inactive" },
  });
  assert.deepEqual(await runOne(h), { state: "cancelled" });
});
test("sync: cancelled while in flight discards the answer and records only its cost", async () => {
  const h = syncHarness(syncJob(), {
    respond: async (_body, _options, harness) => {
      harness.deactivate();
      return answer(valid);
    },
  });
  assert.deepEqual(await runOne(h), { state: "cancelled" });
  const finished = finishArgs(h);
  assert.equal(finished.p_failed, true);
  assert.deepEqual(finished.p_result, { blooms: [], no_output_reason: null }, "the answer is not passed on");
  assert.equal(finished.p_input_tokens, 100);
});
test("sync: a retryable provider error closes the dispatch uncharged and retries", async () => {
  const h = syncHarness(syncJob(), { respond: async () => refusal(503) });
  assert.deepEqual(await runOne(h), { state: "retry_scheduled", reason: "provider_error" });
  assert.deepEqual(names(h).slice(-2), ["mark_garden_dispatch", "update_garden_job"]);
  assert.equal(h.calls.at(-2)[1].p_rejected, true);
  assert.equal(finishArgs(h), undefined);
});
test("sync: a retryable provider error stops retrying after five attempts", async () => {
  const h = syncHarness(syncJob({ attempts: 5 }), { respond: async () => refusal(429) });
  assert.deepEqual(await runOne(h), { state: "failed", reason: "provider_error" });
});
test("sync: a permanent provider error fails the pass", async () => {
  const h = syncHarness(syncJob(), { respond: async () => refusal(400) });
  assert.deepEqual(await runOne(h), { state: "failed", reason: "provider_error" });
  assert.equal(finishArgs(h).p_failed, true);
});
test("sync: invalid output fails the pass but keeps the usage it cost", async () => {
  const h = syncHarness(syncJob(), {
    respond: async () => answer({ ...valid, blooms: [{ ...bloom, evidence: [{ revision_id: "r1", excerpt: "invented" }] }] }),
  });
  assert.deepEqual(await runOne(h), { state: "failed", reason: "invalid_output" });
  assert.equal(finishArgs(h).p_failed, true);
  assert.equal(finishArgs(h).p_output_tokens, 40);
});
test("sync: a tool call in the answer is refused", async () => {
  const withTool = answer(valid);
  withTool.body.output.push({ type: "function_call", name: "send_email" });
  const h = syncHarness(syncJob(), { respond: async () => withTool });
  assert.deepEqual(await runOne(h), { state: "failed", reason: "invalid_output" });
});
test("sync: an oversized snapshot is failed before any dispatch", async () => {
  const big = [{ ...snapshot[0], body: "x".repeat(syncLimits.requestBytes) }];
  const h = syncHarness(syncJob({ snapshot: big }), { respond: () => assert.fail("no provider call") });
  assert.deepEqual(await runOne(h), { state: "failed", reason: "oversized_snapshot" });
  assert.equal(names(h).includes("mark_garden_dispatch"), false);
});
test("sync: too little of the function's time left defers without dispatching", async () => {
  // The claim itself used up the invocation: the clock jumps once the job is in hand.
  let clock = Date.parse("2026-11-16T00:00:00Z");
  const job = syncJob({ created_at: new Date(clock).toISOString() });
  const h = syncHarness(job, {
    respond: () => assert.fail("no provider call"),
    now: () => clock,
    ledger: {
      claim_garden_pass: () => {
        clock += 60_000;
        return job;
      },
    },
  });
  assert.deepEqual(await runOne(h), { state: "deferred", reason: "time_budget" });
  assert.equal(names(h).includes("mark_garden_dispatch"), false);
  assert.deepEqual(h.calls.at(-1)[1], { p_id: "j", p_token: "t", p_release: true });
});
test("sync: an expired pass is failed without a provider call", async () => {
  const h = syncHarness(syncJob({ created_at: new Date(Date.now() - 31 * 3_600_000).toISOString() }), {
    respond: () => assert.fail("no provider call"),
  });
  assert.deepEqual(await runOne(h), { state: "expired", reason: "deadline" });
});
test("sync: a cancelled pass that never dispatched is settled, then cleaned with no provider call", async () => {
  const cancelled = syncJob({ status: "cancelled", settled: false });
  const first = syncHarness(cancelled, { respond: () => assert.fail("no provider call") });
  assert.deepEqual(await runOne(first), { state: "cancelled" });
  const second = syncHarness({ ...cancelled, settled: true }, { respond: () => assert.fail("no provider call") });
  assert.deepEqual(await runOne(second), { state: "cleaned" });
  assert.equal(second.calls.at(-1)[1].p_clean, true);
});
test("sync: a provider without a synchronous call fails the pass rather than falling back to batch", async () => {
  const h = syncHarness(syncJob(), {});
  delete h.provider.respond;
  assert.deepEqual(await runOne(h), { state: "failed", reason: "transport_unavailable" });
});
test("a batch pass never uses the synchronous call", async () => {
  const h = harness(
    { id: "j", token: "t", status: "queued", transport: "batch", snapshot, model: "pinned", created_at: new Date().toISOString() },
    {},
  );
  h.provider.respond = () => assert.fail("batch never calls respond");
  assert.equal((await runOne(h)).state, "submitted");
});
test("http adapter: sync call sends store:false to the Responses endpoint and drops error bodies", async () => {
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push([url, options]);
    return seen.length === 1
      ? new Response(JSON.stringify({ status: "completed", output: [], usage: {} }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "echoed private text" } }), { status: 500 });
  };
  const provider = httpProvider("synthetic-key", fetcher);
  const ok = await provider.respond({ model: "m", store: false }, { timeoutMs: 1000, key: "k" });
  assert.equal(ok.status_code, 200);
  assert.equal(seen[0][0], "https://api.openai.com/v1/responses");
  assert.equal(seen[0][1].headers["Idempotency-Key"], "k");
  assert.equal(JSON.parse(seen[0][1].body).store, false);
  const failed = await provider.respond({ model: "m", store: false }, { timeoutMs: 1000 });
  assert.deepEqual(failed, { status_code: 500, body: null, retryable: true });
});
test("http adapter: a timed-out sync call is reported as a timeout, without a body", async () => {
  const provider = httpProvider("synthetic-key", (_url, options) =>
    new Promise((_resolve, reject) => {
      // AbortSignal.timeout does not keep the event loop alive on its own.
      const keepAlive = setTimeout(() => {}, 5000);
      options.signal.addEventListener("abort", () => {
        clearTimeout(keepAlive);
        reject(options.signal.reason);
      });
    }),
  );
  await assert.rejects(provider.respond({ model: "m" }, { timeoutMs: 20 }), (error) => error.timeout === true && error.message === "provider_request_failed");
});
