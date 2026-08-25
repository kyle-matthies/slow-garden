import assert from 'node:assert/strict';

export function validateCandidate({ mode, sources, blooms }) {
  const errors = [];
  const sourceByHandle = new Map(sources.map((source) => [source.handle, source]));

  if (!Array.isArray(blooms) || blooms.length > 3) errors.push('bloom_count');

  for (const [bloomIndex, bloom] of (blooms ?? []).entries()) {
    if (!Array.isArray(bloom.claims) || bloom.claims.length === 0) {
      errors.push(`bloom_${bloomIndex}:claims_required`);
      continue;
    }

    for (const [claimIndex, claim] of bloom.claims.entries()) {
      if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
        errors.push(`bloom_${bloomIndex}:claim_${claimIndex}:evidence_required`);
        continue;
      }

      for (const evidence of claim.evidence) {
        if (evidence.type === 'research' && mode !== 'explore') {
          errors.push(`bloom_${bloomIndex}:claim_${claimIndex}:research_forbidden`);
          continue;
        }
        if (evidence.type !== 'source') continue;
        const source = sourceByHandle.get(evidence.handle);
        if (!source) {
          errors.push(`bloom_${bloomIndex}:claim_${claimIndex}:unknown_handle`);
          continue;
        }
        if (source.text.slice(evidence.start, evidence.end) !== evidence.excerpt) {
          errors.push(`bloom_${bloomIndex}:claim_${claimIndex}:excerpt_mismatch`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

const sources = [
  { handle: 'S1', text: 'Leave room before naming the solution.' },
  { handle: 'S2', text: 'What changes once this becomes a roadmap?' },
];

const valid = validateCandidate({
  mode: 'connect',
  sources,
  blooms: [{ claims: [{ evidence: [{ type: 'source', handle: 'S1', start: 0, end: 10, excerpt: 'Leave room' }] }] }],
});
assert.deepEqual(valid, { valid: true, errors: [] });

assert.equal(validateCandidate({ mode: 'connect', sources, blooms: new Array(4).fill({ claims: [] }) }).valid, false);
assert(validateCandidate({ mode: 'connect', sources, blooms: [{ claims: [{ evidence: [] }] }] }).errors.includes('bloom_0:claim_0:evidence_required'));
assert(validateCandidate({ mode: 'connect', sources, blooms: [{ claims: [{ evidence: [{ type: 'source', handle: 'NOPE', start: 0, end: 1, excerpt: 'x' }] }] }] }).errors.includes('bloom_0:claim_0:unknown_handle'));
assert(validateCandidate({ mode: 'connect', sources, blooms: [{ claims: [{ evidence: [{ type: 'source', handle: 'S1', start: 0, end: 5, excerpt: 'Wrong' }] }] }] }).errors.includes('bloom_0:claim_0:excerpt_mismatch'));
assert(validateCandidate({ mode: 'connect', sources, blooms: [{ claims: [{ evidence: [{ type: 'research', url: 'https://example.test' }] }] }] }).errors.includes('bloom_0:claim_0:research_forbidden'));

console.log(JSON.stringify({ fixtures: 6, validAccepted: 1, invalidRejected: 5, assertions: 'passed' }));

