import assert from 'node:assert/strict';

function applyMutation({ serverHead, mutation }) {
  if (mutation.idempotencyKey === serverHead.lastMutationKey) {
    return { kind: 'duplicate', head: serverHead };
  }
  if (mutation.baseRevisionId !== serverHead.revisionId) {
    return {
      kind: 'conflict',
      server: serverHead,
      local: mutation,
      resolutionRequired: true,
    };
  }
  return {
    kind: 'applied',
    head: {
      revisionId: mutation.newRevisionId,
      body: mutation.body,
      lastMutationKey: mutation.idempotencyKey,
    },
  };
}

const initial = { revisionId: 'r1', body: 'unfinished thought', lastMutationKey: null };
const first = applyMutation({
  serverHead: initial,
  mutation: { baseRevisionId: 'r1', newRevisionId: 'r2', body: 'edited offline', idempotencyKey: 'm1' },
});
assert.equal(first.kind, 'applied');
assert.equal(first.head.body, 'edited offline');

const duplicate = applyMutation({
  serverHead: first.head,
  mutation: { baseRevisionId: 'r1', newRevisionId: 'r2', body: 'edited offline', idempotencyKey: 'm1' },
});
assert.equal(duplicate.kind, 'duplicate');

const divergent = applyMutation({
  serverHead: first.head,
  mutation: { baseRevisionId: 'r1', newRevisionId: 'r3', body: 'different device edit', idempotencyKey: 'm2' },
});
assert.equal(divergent.kind, 'conflict');
assert.equal(divergent.server.body, 'edited offline');
assert.equal(divergent.local.body, 'different device edit');
assert.equal(divergent.resolutionRequired, true);

console.log(JSON.stringify({ applied: 1, duplicateSuppressed: 1, divergentConflictPreserved: 1, assertions: 'passed' }));

