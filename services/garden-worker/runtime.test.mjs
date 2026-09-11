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
