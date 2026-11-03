import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchStatus, valuationBlocker } from '../src/lib/status';
import { buildResearch } from '../src/lib/research';
import type { Research } from '../src/lib/types';
import { calculate } from '../src/lib/valuation';
import { assumptions, complete, input } from './fixtures';

test('missing accounting inputs are distinguished from invalid model edits', () => {
  const r = { specialized: false, current: { end: '2026-06-30' }, findings: [{ code: 'MISSING_debt', severity: 'error' }] } as Research;
  assert.equal(researchStatus(r, null), 'ACCOUNTING REVIEW');
  assert.equal(researchStatus(r, null, 'Invalid WACC'), 'INVALID');
  assert.equal(researchStatus({ ...r, current: null }, null), 'DATA UNAVAILABLE');
  assert.equal(researchStatus({ ...r, specialized: true }, null), 'SPECIALIZED VALUATION REQUIRED');
  assert.notEqual(researchStatus({ ...r, findings: [] }, calculate(input, assumptions)), 'VERIFIED INPUTS');
});

test('a withheld value states the actual blocker and prioritizes specialized methods', () => {
  const findings = [{ code: 'MISSING_debt', severity: 'error' as const, message: 'Could not verify total interest-bearing debt for the period ended 2026-06-30.' }];
  const r = { specialized: false, findings } as Research;
  assert.equal(valuationBlocker(r, null), findings[0].message);
  assert.equal(valuationBlocker(r, null, 'WACC must exceed terminal growth.'), 'WACC must exceed terminal growth.');
  assert.equal(valuationBlocker({ ...r, specialized: true, findings: [...findings, { code: 'SPECIALIZED', severity: 'error', message: 'Separate industrial and financing operations.' }] }, null), 'Separate industrial and financing operations.');
});

test('CAT financial services require a specialized valuation', async () => {
  const facts = complete(); facts.cik = 18230;
  const r = await buildResearch('CAT', { facts, submissions: { cik: '18230', name: 'Test-only CAT eligibility fixture', sic: '3531', sicDescription: 'Machinery', tickers: ['CAT'], exchanges: ['NYSE'], fiscalYearEnd: '1231' } });
  assert.equal(r.specialized, true); assert.equal(r.input, null);
});
