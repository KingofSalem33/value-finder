import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, getFact, normalize, standaloneQuarter, ttmValue } from '../src/lib/normalize';
import { add, complete, data, retrievedAt } from './fixtures';

test('annual statement extraction keeps all provenance', () => {
  const r = normalize(complete(), retrievedAt); const f = r.current!.values.revenue!;
  assert.equal(f.value, 1000); assert.equal(f.unit, 'USD'); assert.equal(f.start, '2025-01-01'); assert.equal(f.end, '2025-12-31'); assert.equal(f.filed, '2026-02-01'); assert.equal(f.retrievedAt, retrievedAt); assert.match(f.url, /sec.gov\/Archives/); assert.equal(r.current!.reportedFcf, 110);
});
test('missing values stay missing and block model', () => { const r = normalize(data(), retrievedAt); assert.equal(r.current, null); assert.ok(r.findings.some(f => f.severity === 'error')); const d = data(); add(d, 'revenue', 50); const partial = normalize(d, retrievedAt); assert.equal(partial.current!.values.cash, undefined); assert.ok(partial.findings.some(f => f.code === 'MISSING_cash')); });
test('amended fact wins exact-period duplicates', () => { const d = complete(); add(d, 'revenue', 1050, undefined, undefined, { filed: '2026-03-01', form: '10-K/A', accn: '0000000001-26-000002' }); assert.equal(getFact(d, 'revenue', '2025-01-01', '2025-12-31', retrievedAt)!.value, 1050); });
test('as-of selection excludes later disclosures', () => { const d = complete(); add(d, 'revenue', 1050, undefined, undefined, { filed: '2026-03-01', form: '10-K/A' }); assert.equal(getFact(d, 'revenue', '2025-01-01', '2025-12-31', retrievedAt, '2026-02-15')!.value, 1000); });
test('quarterly or YTD revenue never replaces annual revenue', () => { const d = complete(); add(d, 'revenue', 300, '2025-10-01', '2025-12-31', { filed: '2026-03-01', form: '10-Q' }); assert.equal(normalize(d, retrievedAt).current!.values.revenue!.value, 1000); });
test('noncalendar fiscal year is matched by dates', () => { const d = data(); add(d, 'revenue', 100, '2024-07-01', '2025-06-30'); const r = normalize(d, retrievedAt); assert.equal(r.periods[0].start, '2024-07-01'); assert.equal(r.periods[0].end, '2025-06-30'); assert.equal(daysBetween(r.periods[0].start, r.periods[0].end), 365); });
test('TTM arithmetic uses annual + current YTD - comparable prior YTD', () => { assert.equal(ttmValue(1000, 600, 500), 1100); assert.equal(standaloneQuarter(600, 250), 350); assert.equal(standaloneQuarter(null, 250), null); });
test('TTM cash flows and day-weighted shares use fiscal YTD', () => {
  const d = complete();
  for (const [metric, current, previous] of [['revenue', 600, 500], ['ocf', 90, 80], ['capex', 40, 25], ['ebit', 120, 100], ['shares', 12, 10]] as const) {
    add(d, metric, previous, '2025-01-01', '2025-06-30', { form: '10-Q', filed: '2025-08-01' });
    add(d, metric, current, '2026-01-01', '2026-06-30', { form: '10-Q', filed: '2026-08-01' });
  }
  const r = normalize(d, retrievedAt); assert.equal(r.current!.kind, 'ttm'); assert.equal(r.current!.values.revenue!.value, 1100); assert.equal(r.current!.values.ocf!.value, 170); assert.equal(r.current!.values.capex!.value, 65); assert.equal(r.current!.reportedFcf, 105);
  assert.ok(Math.abs(r.current!.values.shares!.value - (10 * 365 + 2 * 181) / 365) < 1e-10);
  assert.equal(r.current!.values.ocf!.derivedFrom!.length, 3);
});
test('unavailable comparable YTD does not make a false TTM', () => { const d = complete(); add(d, 'revenue', 600, '2026-01-01', '2026-06-30', { form: '10-Q', filed: '2026-08-01' }); const r = normalize(d, retrievedAt); assert.equal(r.current!.kind, 'annual'); assert.ok(r.findings.some(f => f.code === 'NO_TTM')); });
test('unexpected negative capex is an error, not a sign flip', () => { const d = complete(); add(d, 'capex', -50, undefined, undefined, { filed: '2026-03-01' }); const r = normalize(d, retrievedAt); assert.equal(r.current!.values.capex!.value, -50); assert.ok(r.findings.some(f => f.code === 'SIGN_capex' && f.severity === 'error')); });
test('high capex and negative FCF do not by themselves invalidate a business', () => { const d = complete(); add(d, 'capex', 250, undefined, undefined, { filed: '2026-03-01' }); const r = normalize(d, retrievedAt); assert.equal(r.current!.reportedFcf, -90); assert.ok(r.findings.some(f => f.code === 'CAPITAL_CYCLE')); assert.ok(!r.findings.some(f => f.severity === 'error')); });
test('mixed reporting currencies block a per-share result', () => { const d = complete(); add(d, 'cash', 110, undefined, undefined, { filed: '2026-03-01', unit: 'EUR' }); assert.ok(normalize(d, retrievedAt).findings.some(f => f.code === 'CURRENCY')); });
test('large unexplained share change blocks valuation', () => { const d = complete(); add(d, 'revenue', 800, '2024-01-01', '2024-12-31', { filed: '2025-02-01' }); add(d, 'shares', 100, '2024-01-01', '2024-12-31', { filed: '2025-02-01' }); assert.ok(normalize(d, retrievedAt).findings.some(f => f.code === 'SHARE_CHANGE')); });
test('debt alternatives are not double counted', () => { const d = complete(); add(d, 'debtCurrent', 20); add(d, 'debtNoncurrent', 180); assert.equal(normalize(d, retrievedAt).current!.values.debt!.value, 200); });
test('current plus noncurrent debt is explicitly derived when total is absent', () => { const d = complete(); delete d.facts['us-gaap'].LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities; add(d, 'debtCurrent', 20); add(d, 'debtNoncurrent', 180); const f = normalize(d, retrievedAt).current!.values.debt!; assert.equal(f.value, 200); assert.equal(f.derivedFrom!.length, 2); });
