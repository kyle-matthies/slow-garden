import assert from 'node:assert/strict';

const terminal = new Set(['complete', 'failed', 'cancelled', 'expired']);

class Ledger {
  constructor() {
    this.passes = new Map();
    this.events = new Set();
    this.blooms = new Map();
  }

  createPass({ key, snapshot, heads }) {
    if (this.passes.has(key)) return this.passes.get(key);
    const pass = { key, snapshot, heads, status: 'queued', cancelled: false };
    this.passes.set(key, pass);
    return pass;
  }

  apply(event) {
    if (this.events.has(event.id)) return 'duplicate';
    this.events.add(event.id);
    const pass = this.passes.get(event.passKey);
    assert(pass, 'event must reference an existing pass');
    if (terminal.has(pass.status)) return 'terminal-noop';

    if (event.type === 'cancel') {
      pass.cancelled = true;
      pass.status = 'cancelled';
      return 'cancelled';
    }

    if (event.type === 'provider-accepted') {
      pass.status = 'processing';
      pass.providerId ??= event.providerId;
      assert.equal(pass.providerId, event.providerId, 'one accepted provider job per attempt');
      return 'processing';
    }

    if (event.type === 'result') {
      if (pass.cancelled) return 'cancelled-noop';
      assert(event.blooms.length <= 3, 'at most three blooms');
      const outputKey = `${event.attempt}:${event.outputHash}`;
      if (!this.blooms.has(outputKey)) this.blooms.set(outputKey, event.blooms);
      pass.status = event.stale ? 'stale' : 'complete';
      return pass.status;
    }

    throw new Error(`unknown event ${event.type}`);
  }
}

const ledger = new Ledger();
const first = ledger.createPass({ key: 'garden:manifest:connect:v1', snapshot: 's1', heads: ['r1'] });
const duplicate = ledger.createPass({ key: 'garden:manifest:connect:v1', snapshot: 's1', heads: ['r1'] });
assert.equal(first, duplicate, 'duplicate trigger returns same pass');

assert.equal(ledger.apply({ id: 'e1', passKey: first.key, type: 'provider-accepted', providerId: 'batch-1' }), 'processing');
assert.equal(ledger.apply({ id: 'e1', passKey: first.key, type: 'provider-accepted', providerId: 'batch-1' }), 'duplicate');
assert.equal(ledger.apply({ id: 'e2', passKey: first.key, type: 'result', attempt: 1, outputHash: 'o1', blooms: ['b1'], stale: true }), 'stale');
assert.equal(ledger.apply({ id: 'e3', passKey: first.key, type: 'result', attempt: 1, outputHash: 'o1', blooms: ['b1'], stale: false }), 'complete');
assert.equal(ledger.blooms.size, 1, 'result ingestion is idempotent');

const cancelled = ledger.createPass({ key: 'garden:manifest2:connect:v1', snapshot: 's2', heads: ['r2'] });
assert.equal(ledger.apply({ id: 'e4', passKey: cancelled.key, type: 'cancel' }), 'cancelled');
assert.equal(ledger.apply({ id: 'e5', passKey: cancelled.key, type: 'result', attempt: 1, outputHash: 'o2', blooms: ['late'], stale: false }), 'terminal-noop');
assert.equal(ledger.blooms.size, 1, 'late cancelled result is not revealed');

console.log(JSON.stringify({ passes: ledger.passes.size, persistedBloomSets: ledger.blooms.size, assertions: 'passed' }));

