import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import coverage from '../src/data/coverage.json';
import records from '../src/data/research-records.json';
import type { Research } from '../src/lib/types';
import { calculate, MODEL_VERSION, reverseDcf } from '../src/lib/valuation';

for (const symbol of Object.keys(coverage)) {
  const r = (records as unknown as Record<string, Research>)[symbol];
  assert.ok(r, `${symbol}: offline regression record is missing.`);
  assert.equal(r.version, MODEL_VERSION);
  assert.ok(r.current && r.periods.length >= 5);
  for (const ref of r.references) {
    if (typeof ref.values.sha256 !== 'string') continue;
    assert.match(ref.values.sha256, /^[a-f0-9]{64}$/);
    const body = gunzipSync(await readFile(`public/filings/${ref.values.sha256}.gz`));
    assert.equal(createHash('sha256').update(body).digest('hex'), ref.values.sha256);
  }
  if (symbol === 'CAT') assert.ok(r.specialized && !r.input);
  else {
    assert.ok(r.input && r.assumptions);
    const before = calculate(r.input, r.assumptions);
    assert.ok(before.equityValue > 0);
    assert.equal(before.perShare, r.serverScenarios!.base.result!.perShare);
    reverseDcf(r.input, r.assumptions, 100);
    reverseDcf(r.input, r.assumptions, 500);
    assert.equal(before.perShare, calculate(r.input, r.assumptions).perShare);
  }
  console.log(`${symbol}: accepted record, source hashes, model version and valuation checks passed`);
}
