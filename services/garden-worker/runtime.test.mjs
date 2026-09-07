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
  return {
    calls,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "claim_garden_pass") return job;
      if (name === "check_garden_pass") return true;
    },
    provider: {
      upload: async () => "file",
      createBatch: async () => "batch",
      getBatch: async () => ({ status: "in_progress" }),
      cancelBatch: async () => {},
      deleteFile: async () => {},
      ...overrides,
    },
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
