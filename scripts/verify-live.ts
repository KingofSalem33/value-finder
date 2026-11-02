import { writeFile, mkdir } from 'node:fs/promises';
import { calculate, MODEL_VERSION, scenarios, reverseDcf } from '../src/lib/valuation';
import acceptedRecords from '../src/data/research-records.json';
import type { Research } from '../src/lib/types';
const base = process.env.VERIFY_URL ?? 'https://value-finder-research.vercel.app';
const results = [];
let failures = 0;
await mkdir('output/verification', { recursive: true });
for (const symbol of ['AMD', 'AAPL', 'MSFT', 'CAT', 'TXN', 'AGX', 'AMZN']) {
  try {
    const response = await fetch(`${base}/api/research?symbol=${symbol}`, { signal: AbortSignal.timeout(60000) });
    const raw = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${raw.error}`);
    const r = raw as Research;
    await writeFile(`output/verification/${symbol}.json`, JSON.stringify(r, null, 2));
    const accepted = (acceptedRecords as unknown as Record<string, Research>)[symbol];
    const checks: Record<string, boolean> = { matchingSymbol: r.symbol === symbol, modelVersion: r.version === MODEL_VERSION, acceptedInputDigest: !!accepted && r.inputDigest === accepted.inputDigest, acceptedCollectionTime: !!accepted && r.retrievedAt === accepted.retrievedAt, hasProvenance: !!r.current?.values.revenue?.url, missingFactsFlagged: !r.findings.some(f => f.code.startsWith('MISSING_')) || r.input === null };
    const errors = r.findings.filter(f => f.severity === 'error');
    const model = r.input && r.assumptions ? calculate(r.input, r.assumptions) : null;
    checks.expectedCoverage = symbol === 'CAT' ? r.specialized && !model : !!model;
    if (model && r.input && r.assumptions) {
      checks.cashFlowIdentity = model.years.every(y => Math.abs(y.nopat - y.reinvestment - y.fcff) < Math.max(1, Math.abs(y.fcff) * 1e-9) && (y.capex === null || y.da === null || y.workingCapital === null || Math.abs(y.capex - y.da + y.workingCapital - y.reinvestment) < Math.max(1, Math.abs(y.reinvestment) * 1e-9)));
      checks.terminalIdentity = Math.abs(model.terminalReinvestment / model.terminalNopat - r.assumptions.terminalGrowth / r.assumptions.terminalRoic) < 1e-9;
      const before = model.perShare;
      reverseDcf(r.input, r.assumptions, Math.max(1, before));
      reverseDcf(r.input, r.assumptions, Math.max(2, before * 2));
      checks.priceIndependence = before === calculate(r.input, r.assumptions).perShare;
      checks.serverParity = !!r.serverScenarios?.base.result && Math.abs(r.serverScenarios.base.result.perShare - before) < 1e-6;
      const cases = scenarios(r.input, r.assumptions);
      checks.scenarioCashFlowsDiffer = !!cases.bear.result && !!cases.bull.result && cases.bear.result.years[0].fcff !== cases.bull.result.years[0].fcff;
    }
    const passed = Object.values(checks).every(Boolean);
    if (!passed) failures++;
    const entry = { symbol, http: response.status, periodEnd: r.current?.end, period: r.current?.kind, revenue: r.current?.values.revenue?.value, reportedFcf: r.current?.reportedFcf, errors: errors.map(e => e.code), modelAvailable: !!model, perShare: model?.perShare, wacc: model?.wacc, checks, passed };
    results.push(entry); console.log(JSON.stringify(entry));
  } catch (e) { failures++; const entry = { symbol, passed: false, error: (e as Error).message }; results.push(entry); console.log(JSON.stringify(entry)); }
}
const report = { url: base, checkedAt: new Date().toISOString(), scope: 'Deployed accepted-record parity and arithmetic invariants, not independent accounting or fair-value verification.', results, failures };
await writeFile('output/verification/live-report.json', JSON.stringify(report, null, 2));
process.exitCode = failures ? 1 : 0;
