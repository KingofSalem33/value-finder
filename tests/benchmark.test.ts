import { test } from 'node:test';
import assert from 'node:assert/strict';
import source from './damodaran-benchmark.json';
import { equityBridge, listedShareValue, terminalValue } from '../src/lib/valuation';

const value = (key: keyof typeof source.values) => Number(source.values[key].value);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('terminal reinvestment and value agree with the published Damodaran workbook cells', () => {
  const result = terminalValue(value('nopat'), value('growth'), value('roic'), value('wacc'));
  close(result.fcff, value('terminalFcff'));
  close(result.value, value('terminalValue'));
});

test('equity bridge and share value agree with the published workbook cells', () => {
  const equity = equityBridge(value('enterpriseValue'), { cash: value('cash'), debt: value('debt'), minority: value('minority'), otherAssets: value('otherAssets'), leaseDebt: 0, preferred: 0, otherClaims: 0, shares: value('shares') });
  close(equity, value('equityValue'));
  close(listedShareValue(equity, value('shares'), 1, 1), value('perShare'));
});
