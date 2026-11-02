import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRecord } from '../scripts/build-records';
import { createResearch, type CollectedCompany } from '../src/lib/research';
import { normalize } from '../src/lib/normalize';
import references from '../src/data/reference-snapshot.json';
import type { ReferenceSet, Submissions } from '../src/lib/types';
import { add, complete, retrievedAt } from './fixtures';

const refs = references.Semiconductor as unknown as ReferenceSet;
const company: Submissions = { cik: '2488', name: 'Test-only record fixture', sic: '3674', sicDescription: 'Semiconductors', tickers: ['AMD'], exchanges: ['Nasdaq'], fiscalYearEnd: '1231', filings: { recent: { form: ['10-K'], reportDate: ['2025-12-31'], filingDate: ['2026-02-01'], accessionNumber: ['0000002488-26-000001'], primaryDocument: ['test-only.htm'] } } };
function candidate(): CollectedCompany {
  const facts = complete(); facts.cik = 2488;
  for (const year of [2021, 2022, 2023, 2024]) add(facts, 'revenue', 800 + (year - 2021) * 40, `${year}-01-01`, `${year}-12-31`, { filed: `${year + 1}-02-01` });
  return { schemaVersion: 1, collectorVersion: 'test-only', parserVersion: '5.62.1', symbol: 'AMD', facts, submissions: company, retrievedAt, documents: [{ url: 'https://example.com/test-only', sha256: 'a'.repeat(64), retrievedAt, bytes: 0 }] };
}

test('acceptance refuses missing accounting data and unreviewed parser versions', () => {
  assert.ok(compileRecord(candidate(), refs).serverScenarios?.base.result);
  const missing = candidate(); delete missing.facts.facts['us-gaap'].LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities;
  assert.throws(() => compileRecord(missing, refs), /MISSING_debt/);
  assert.throws(() => compileRecord({ ...candidate(), parserVersion: 'unknown' }, refs), /Parser upgrades/);
  const wrongIssuer = candidate(); wrongIssuer.facts.cik = 1;
  assert.throws(() => compileRecord(wrongIssuer, refs), /CIK/);
  const unnormalized = candidate(); unnormalized.submissions = { ...company, filings: { recent: { ...company.filings!.recent, form: ['10-Q'], reportDate: ['2026-06-30'] } } };
  assert.throws(() => compileRecord(unnormalized, refs), /newer financial filing/);
});

test('the bridge does not duplicate current short debt or current finance leases', () => {
  const raw = candidate();
  delete raw.facts.facts['us-gaap'].LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities;
  add(raw.facts, 'debtCurrent', 40, undefined, undefined, { tag: 'DebtCurrent' });
  add(raw.facts, 'debtNoncurrent', 160, undefined, undefined, { tag: 'LongTermDebtNoncurrent' });
  add(raw.facts, 'shortDebt', 10);
  add(raw.facts, 'financeLeaseCurrent', 4, undefined, undefined, { start: undefined });
  add(raw.facts, 'financeLeaseNoncurrent', 6, undefined, undefined, { start: undefined });
  const result = createResearch('AMD', raw, refs);
  assert.equal(result.input!.bridge.debt, 200);
  assert.equal(result.input!.bridge.leaseDebt, 6);
});

test('operating working capital excludes cash and investments and removes financing once', () => {
  const d = complete();
  add(d, 'assetsCurrent', 1000, undefined, undefined, { start: undefined });
  add(d, 'liabilitiesCurrent', 600, undefined, undefined, { start: undefined });
  add(d, 'investments', 200, undefined, undefined, { start: undefined });
  add(d, 'debtCurrent', 50, undefined, undefined, { tag: 'DebtCurrent' });
  add(d, 'shortDebt', 10);
  add(d, 'leaseCurrent', 20, undefined, undefined, { start: undefined });
  add(d, 'financeLeaseCurrent', 5, undefined, undefined, { start: undefined });
  assert.equal(normalize(d, retrievedAt).current!.workingCapital, 170);
});
