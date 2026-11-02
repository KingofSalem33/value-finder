import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResearch } from '../src/lib/research';
import { validSnapshot } from '../src/lib/snapshot';
import type { ReferenceSet } from '../src/lib/types';
import amd from './filings/amd-extract.json';
import references from '../src/data/reference-snapshot.json';

test('saved provenance accepts nested D&A and rejects malformed derivations', () => {
  const research = createResearch('AMD', { facts: amd, retrievedAt: '2026-11-02T23:00:00Z', submissions: { cik: '2488', name: amd.entityName, sic: '3674', sicDescription: 'Semiconductors', tickers: ['AMD'], exchanges: ['Nasdaq'], fiscalYearEnd: '1227' } }, references.Semiconductor as unknown as ReferenceSet, true);
  const saved = { id: 'test', research, assumptions: research.assumptions, mode: 'auto', note: '', price: '', priceDate: '', savedAt: '2026-11-02T23:00:00Z' };
  assert.equal(validSnapshot(saved), true);
  const malformed = structuredClone(saved);
  Object.assign(malformed.research.current!.values.da!, { derivedFrom: 'not an evidence array' });
  assert.equal(validSnapshot(malformed), false);
  const badUrl = structuredClone(saved);
  badUrl.research.current!.values.revenue!.url = 'javascript:alert(1)';
  assert.equal(validSnapshot(badUrl), false);
});
