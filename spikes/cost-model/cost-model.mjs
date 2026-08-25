import assert from 'node:assert/strict';

export function monthlyModelCost({ passes, inputTokens, outputTokens, inputRate, outputRate }) {
  return passes * ((inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate);
}

const rates = { inputRate: 0.75, outputRate: 4.5 };
const scenarios = {
  expected: { passes: 22, inputTokens: 15_000, outputTokens: 2_000, ...rates },
  stress: { passes: 87, inputTokens: 50_000, outputTokens: 4_000, ...rates },
  runaway: { passes: 1_000, inputTokens: 100_000, outputTokens: 8_000, ...rates },
};

const result = Object.fromEntries(
  Object.entries(scenarios).map(([name, values]) => [name, Number(monthlyModelCost(values).toFixed(2))]),
);

assert.equal(result.expected, 0.45);
assert.equal(result.stress, 4.83);
assert(result.runaway > 100, 'runaway scenario must breach the hard cap');
assert(result.expected < 10, 'expected usage must remain below soft cap');

console.log(JSON.stringify({ ratesPerMillionTokens: rates, monthlyModelCostUsd: result, assertions: 'passed' }));

