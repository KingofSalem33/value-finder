import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import coverage from '../src/data/coverage.json';
import { createResearch, type CollectedCompany } from '../src/lib/research';
import { MODEL_VERSION } from '../src/lib/valuation';
import type { ReferenceSet, Research } from '../src/lib/types';

export function compileRecord(raw: CollectedCompany, refs: ReferenceSet): Research {
  const profile = (coverage as Record<string, { cik: number; specialized?: string }>)[raw.symbol];
  assert.ok(profile && profile.cik === Number(raw.facts.cik), 'Coverage symbol and source CIK must match.');
  assert.equal(raw.schemaVersion, 1, 'Unsupported collector schema.');
  assert.equal(raw.parserVersion, '5.62.1', 'Parser upgrades require renewed filing checks.');
  assert.ok(raw.documents.length > 0, 'Source documents are required.');
  assert.ok(refs.references.some(ref => ref.name.includes('monthly implied ERP')), 'A dated monthly ERP is required.');
  const record = createResearch(raw.symbol, raw, refs);
  assert.ok(record.current && record.periods.length >= 5, `${raw.symbol}: at least five fiscal annual periods are required.`);
  const recent = raw.submissions.filings?.recent;
  assert.ok(recent?.reportDate, 'Latest reported fiscal dates are required for acceptance.');
  const latest = recent.form.flatMap((form, index) => /^10-[KQ]/.test(form) && recent.reportDate![index] ? [recent.reportDate![index]] : []).sort().at(-1);
  assert.equal(record.current.end, latest, `${raw.symbol}: a newer financial filing exists but was not normalized.`);
  if (profile.specialized) {
    assert.ok(record.specialized && record.input === null, 'Specialized firms must not receive generic FCFF values.');
  } else {
    const errors = record.findings.filter(f => f.severity === 'error');
    assert.equal(errors.length, 0, `${raw.symbol}: ${errors.map(f => `${f.code}: ${f.message}`).join('; ')}`);
    assert.ok(record.serverScenarios?.base.result && !record.serverScenarios.base.error, `${raw.symbol}: base forecast is unavailable.`);
    assert.ok(!record.serverScenarios.base.result.findings.some(f => f.severity === 'error'), `${raw.symbol}: base equity value is not supported.`);
  }
  return record;
}

async function main() {
  const refs: Record<string, ReferenceSet> = JSON.parse(await readFile('src/data/reference-snapshot.json', 'utf8'));
  const records: Record<string, Research> = {};
  const results = [];
  for (const [symbol, profile] of Object.entries(coverage)) {
    const path = `output/collection/candidates/${symbol}.json`;
    const sourceBody = await readFile(path);
    const raw: CollectedCompany = JSON.parse(sourceBody.toString('utf8'));
    assert.equal(raw.symbol, symbol, 'Candidate filename and symbol must match.');
    const record = compileRecord(raw, refs[profile.industry]);
    for (const source of raw.documents) {
      assert.match(source.sha256, /^[a-f0-9]{64}$/);
      const body = gunzipSync(await readFile(`public/filings/${source.sha256}.gz`));
      assert.equal(createHash('sha256').update(body).digest('hex'), source.sha256, 'Original source hash mismatch.');
      record.references.push({ name: `Source — ${new URL(source.url).pathname.split('/').at(-1)}`, url: source.url, asOf: source.periodEnd ?? source.retrievedAt.slice(0, 10), retrievedAt: source.retrievedAt, values: { sha256: source.sha256, bytes: source.bytes, archive: `/filings/${source.sha256}.gz`, ...(source.filed ? { filed: source.filed, form: source.form ?? '' } : {}) } });
    }
    const digest = createHash('sha256').update(sourceBody).digest('hex');
    await mkdir('public/filings', { recursive: true });
    await writeFile(`public/filings/${digest}.gz`, gzipSync(sourceBody));
    record.references.push({ name: 'Collected source fact record', url: `/filings/${digest}.gz`, asOf: record.current!.end, retrievedAt: raw.retrievedAt, values: { sha256: digest, collector: raw.collectorVersion, parser: raw.parserVersion } });
    records[symbol] = record;
    const result = { symbol, periodEnd: record.current!.end, annualPeriods: record.periods.length, specialized: record.specialized, inputDigest: record.inputDigest, perShare: record.serverScenarios?.base.result?.perShare ?? null, findings: record.findings.map(f => f.code) };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  // All candidates pass before the single accepted-record file is replaced.
  const body = JSON.stringify(records) + '\n';
  await writeFile('src/data/research-records.json.tmp', body);
  await rename('src/data/research-records.json.tmp', 'src/data/research-records.json');
  await writeFile('src/data/collection-report.json', JSON.stringify({ modelVersion: MODEL_VERSION, checkedAt: new Date().toISOString(), scope: 'Extraction, source hashes and calculation checks; independent accounting review and forecast accuracy are not established.', results }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
