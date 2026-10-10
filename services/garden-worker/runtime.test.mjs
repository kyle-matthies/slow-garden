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
