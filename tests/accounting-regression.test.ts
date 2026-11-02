import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, includesFinanceLeases, includesShortDebt, normalize } from '../src/lib/normalize';
import { buildResearch, observedGrowth } from '../src/lib/research';
import { calculate } from '../src/lib/valuation';
import amd from './filings/amd-extract.json';
import { add, assumptions, complete, input, retrievedAt } from './fixtures';

test('AMD original-filing extract reconciles TTM D&A components', () => {
  const r = normalize(amd, retrievedAt);
  assert.equal(r.current!.end, '2026-06-27');
  assert.equal(r.current!.values.revenue!.value, 41_305_000_000);
  assert.equal(r.current!.values.da!.value, 3_073_000_000); // 3,050 + (427 + 1,095) − (364 + 1,135), USD m.
  assert.equal(r.current!.values.debt!.value, 3_226_000_000);
  const components = r.current!.values.da!.derivedFrom!;
  assert.equal(components[1].derivedFrom!.length, 2);
  assert.equal(components[1].derivedFrom![0].context, 'c-1');
  assert.equal(components[1].derivedFrom![0].filed, '2026-08-05');
  assert.ok(components[1].derivedFrom![0].url.includes('ir.amd.com'));
});

test('a complete D&A aggregate is not added to its components', () => {
  const d = complete(); add(d, 'depreciation', 25, undefined, undefined, { tag: 'Depreciation' }); add(d, 'amortization', 15);
  assert.equal(normalize(d, retrievedAt).current!.values.da!.value, 40);
});

test('depreciation alone is not a complete D&A figure', () => {
  const d = complete(); delete d.facts['us-gaap'].DepreciationDepletionAndAmortization;
  add(d, 'depreciation', 25, undefined, undefined, { tag: 'Depreciation' });
  assert.equal(normalize(d, retrievedAt).current!.values.da, undefined);
});

test('broad current borrowings retain their short-term debt scope', () => {
  const d = complete(); delete d.facts['us-gaap'].LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities;
  add(d, 'debtCurrent', 40, undefined, undefined, { tag: 'DebtCurrent' }); add(d, 'debtNoncurrent', 160); add(d, 'shortDebt', 10);
  const debt = normalize(d, retrievedAt).current!.values.debt!;
  assert.equal(debt.value, 200); assert.equal(includesShortDebt(debt), true);
});

test('conflicting consolidated duplicates cannot be selected arbitrarily', () => {
  const d = complete(); add(d, 'cash', 101);
  assert.equal(normalize(d, retrievedAt).current!.values.cash, undefined);
  assert.ok(normalize(d, retrievedAt).findings.some(f => f.code === 'MISSING_cash'));
});

test('dimensional facts do not replace the consolidated amount', () => {
  const d = complete(); d.filingFacts = [{ tag: 'us-gaap:OperatingIncomeLoss', unit: 'USD', val: 999, start: '2025-01-01', end: '2025-12-31', form: '10-K', accn: '0000000001-26-000002', filed: '2026-03-01', dimensions: { Business: 'Segment' } }];
  assert.equal(normalize(d, retrievedAt).current!.values.ebit!.value, 200);
});

test('recent growth compares matching YTD periods, not TTM with annual', () => {
  const facts = complete();
  add(facts, 'revenue', 400, '2025-01-01', '2025-06-30', { form: '10-Q', filed: '2025-08-01' });
  add(facts, 'revenue', 600, '2026-01-01', '2026-06-30', { form: '10-Q', filed: '2026-08-01' });
  const r = normalize(facts, retrievedAt);
  assert.equal(r.current!.values.revenue!.value, 1200);
  assert.equal(observedGrowth(r.current!, r.periods)!.value, .5);
});

test('an unmatched annual gap is not labeled one-year growth', () => {
  const facts = complete(); add(facts, 'revenue', 800, '2023-01-01', '2023-12-31', { filed: '2024-02-01' });
  const r = normalize(facts, retrievedAt);
  assert.ok(daysBetween(r.periods[0].end, r.current!.end) > 700);
  assert.equal(observedGrowth(r.current!, r.periods), null);
});

test('unknown allocations stay blank without changing total FCFF', () => {
  const base = calculate(input, assumptions); const unknown = calculate(input, { ...assumptions, wcRatio: null, daRatio: null });
  assert.equal(unknown.enterpriseValue, base.enterpriseValue);
  for (const year of unknown.years) { assert.equal(year.da, null); assert.equal(year.capex, null); assert.equal(year.workingCapital, null); }
});

test('a stock search does not call financial providers', async () => {
  const calls: string[] = []; const spy = mock.method(globalThis, 'fetch', async (input: unknown) => { calls.push(String(input)); throw new Error('Unexpected external request'); });
  try { await assert.rejects(buildResearch('NOTCOLLECTED'), /not been collected/); assert.deepEqual(calls, []); } finally { spy.mock.restore(); }
});

test('a standalone quarter is never substituted for fiscal YTD', () => {
  const d = complete();
  add(d, 'revenue', 300, '2026-04-01', '2026-06-30', { form: '10-Q', filed: '2026-08-01' });
  add(d, 'revenue', 250, '2025-01-01', '2025-03-31', { form: '10-Q', filed: '2025-05-01' });
  const r = normalize(d, retrievedAt);
  assert.equal(r.current!.kind, 'annual'); assert.ok(r.findings.some(f => f.code === 'NO_TTM'));
});

test('current lease coverage does not imply noncurrent lease coverage', () => {
  const d = complete(); delete d.facts['us-gaap'].LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities;
  add(d, 'debtCurrent', 40, undefined, undefined, { tag: 'DebtCurrent' }); add(d, 'debtNoncurrent', 160, undefined, undefined, { tag: 'LongTermDebtNoncurrent' });
  const debt = normalize(d, retrievedAt).current!.values.debt!;
  assert.equal(includesFinanceLeases(debt, 'current'), true);
  assert.equal(includesFinanceLeases(debt, 'noncurrent'), false);
});

test('a dated no-debt disclosure is not carried into another period', () => {
  const d = complete(); delete d.facts['us-gaap'].LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities;
  d.filingFacts = [{ tag: 'review:DebtFree', unit: 'USD', val: 0, end: '2025-12-31', accn: '0000000001-26-000002', form: '8-K', filed: '2026-02-02', url: 'https://example.com/test-source' }];
  assert.equal(normalize(d, retrievedAt).current!.values.debt!.value, 0);
  d.filingFacts[0].end = '2025-09-30';
  assert.equal(normalize(d, retrievedAt).current!.values.debt, undefined);
});
