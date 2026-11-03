import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createSecService, readSec } from '../src/lib/sec';
import { researchFromSec } from '../src/lib/research';
import { calculate, marginOfSafety } from '../src/lib/valuation';

const service = createSecService({ read: readSec });
const symbols = process.argv.slice(2);
const results = [];
await mkdir('output/on-demand', { recursive: true });
for (const symbol of symbols.length ? symbols : ['AMD', 'AAPL', 'MSFT', 'CAT', 'TXN', 'AGX', 'AMZN', 'NVDA', 'COST', 'JNJ']) {
  try {
    const raw = await service(symbol);
    const research = researchFromSec(raw);
    await writeFile(`output/on-demand/${symbol}-inputs.json`, JSON.stringify(raw));
    await writeFile(`output/on-demand/${symbol}.json`, JSON.stringify(research, null, 2));
    const base = research.serverScenarios?.base.result;
    const errors = research.findings.filter(f => f.severity === 'error').map(f => f.code);
    assert.equal(research.origin, 'SEC on-demand');
    if (research.specialized || symbol === 'JNJ') {
      assert.equal(research.input, null);
      if (symbol === 'JNJ') assert.ok(errors.includes('MISSING_ebit') && errors.includes('MISSING_debt'));
    }
    else {
      assert.deepEqual(errors, [], errors.join(', ')); assert.ok(base && research.input && research.assumptions);
      assert.equal(base.perShare, calculate(research.input, research.assumptions).perShare);
      assert.ok(base.years.every(y => Math.abs(y.nopat - y.reinvestment - y.fcff) < 1e-6));
      marginOfSafety(base.perShare, 100); marginOfSafety(base.perShare, 250);
      assert.equal(base.perShare, calculate(research.input, research.assumptions).perShare);
    }
    const result = { symbol, passed: true, end: research.current?.end, perShare: base?.perShare ?? null, industry: research.industry?.name, errors };
    results.push(result); console.log(JSON.stringify(result));
  } catch (error) { const result = { symbol, passed: false, error: (error as Error).message }; results.push(result); console.log(JSON.stringify(result)); }
}
await writeFile('output/on-demand/report.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
