import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCreditTable, parseImpliedErp, parseTreasury } from '../scripts/refresh-references';

test('Treasury parser retains the latest actual observation and rejects stale data', () => {
  const xml = '<m:properties><d:NEW_DATE m:type="Edm.DateTime">2026-10-30T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.94</d:BC_10YEAR></m:properties><m:properties><d:NEW_DATE>2026-11-02T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.91</d:BC_10YEAR></m:properties>';
  assert.deepEqual(parseTreasury(xml, '2026-11-02'), { date: '2026-11-02', rate: .049100000000000005 });
  assert.equal(parseTreasury(xml, '2026-11-01').date, '2026-10-30');
  assert.throws(() => parseTreasury(xml, '2026-11-20'), /recent/);
  assert.throws(() => parseTreasury('<error/>', '2026-11-02'));
});

test('ERP parser selects the dated adjusted-payout variant', () => {
  const html = '<p>Implied ERP on November 1, 2026 = 4.41% (Trailing 12 month, with adjusted payout); 3.79% (Trailing 12 month cash yield)</p>';
  assert.deepEqual(parseImpliedErp(html, '2026-11-02'), { date: '2026-11-01', erp: .0441 });
  assert.throws(() => parseImpliedErp(html, '2027-02-01'), /date or value/);
  assert.throws(() => parseImpliedErp('<p>4.41%</p>', '2026-11-02'), /identified/);
});

test('incomplete credit tables cannot supply invented spreads', () => {
  assert.throws(() => parseCreditTable('<table><tr><td>For large non-financial service firms</td></tr></table>'), /incomplete/);
});

test('the ERP source Treasury basis is retained separately from the current yield', () => {
  const result = parseImpliedErp('<p>Implied ERP on November 1, 2026 = 4.41% (Trailing 12 month, with adjusted payout) (with the US treasury rate of 5.29% used as the riskfree rate)</p>', '2026-11-02');
  assert.equal(result.sourceTreasury, .0529);
});
