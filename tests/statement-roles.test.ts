import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { statementKey, statementRoles } from '../src/lib/statement-roles';
import { parseInstance, type Filing } from '../src/lib/xbrl';
import { getFact, includesShortDebt, normalize } from '../src/lib/normalize';
import { createSecService, type Capture } from '../src/lib/sec';
import { researchFromSec } from '../src/lib/research';
import type { CompanyFacts, Submissions } from '../src/lib/types';
import { add, complete } from './fixtures';

interface Fixture {
  symbol: string; filing: Filing & { url: string; documentUrl: string };
  sourceHashes: { html: string; xml: string }; html: string; xml: string;
  facts: CompanyFacts; expected: { cash?: number; debt?: number; capexYtd?: number };
}
// Genuine SEC numeric instances and primary statement tables; hashes identify originals.
const fixtures = JSON.parse(gunzipSync(readFileSync('tests/filings/statement-fallback.json.gz')).toString('utf8')) as Fixture[];
const retrievedAt = '2026-11-03T00:00:00Z';
function apply(fixture: Fixture, html = fixture.html): CompanyFacts {
  const roles = statementRoles(html);
  const rows = parseInstance(fixture.xml, fixture.filing, fixture.filing.url, retrievedAt);
  for (const row of rows) {
    const role = roles.get(statementKey(row.tag, row.context!));
    if (role) { row.statementMetric = role.metric; row.note = role.label; }
  }
  return { ...structuredClone(fixture.facts), filingFacts: rows };
}

for (const fixture of fixtures) test(`${fixture.symbol}: source statement fallback matches the original reported balance`, () => {
  assert.equal(createHash('sha256').update(fixture.xml).digest('hex'), fixture.sourceHashes.xml);
  const data = apply(fixture);
  const normalized = normalize(data, retrievedAt);
  if (fixture.expected.cash !== undefined) {
    const cash = normalized.current!.values.cash!;
    assert.equal(cash.value, fixture.expected.cash);
    assert.equal(cash.statementMetric, 'cash');
    assert.equal(cash.url, fixture.filing.url);
    assert.ok(cash.context);
    assert.ok(normalized.findings.some(f => f.code === 'CASH_SCOPE'));
  }
  if (fixture.expected.debt !== undefined) {
    const debt = normalized.current!.values.debt!;
    assert.equal(debt.value, fixture.expected.debt);
    assert.equal(debt.derivedFrom!.length, 2);
    assert.equal(includesShortDebt(debt), true, 'Current borrowings must not be added again in the equity bridge');
    assert.ok(debt.derivedFrom!.every(f => f.filed === fixture.filing.filed && f.unit === 'USD'));
  }
  if (fixture.expected.capexYtd !== undefined) {
    const value = getFact(data, 'capex', '2026-01-01', fixture.filing.end, retrievedAt)!;
    assert.equal(value.value, fixture.expected.capexYtd);
    assert.equal(value.tag, 'us-gaap:PaymentsToAcquireOtherPropertyPlantAndEquipment');
  }
});

test('note tables and multiple candidate balance sheets do not supply a guessed cash balance', () => {
  const pg = fixtures.find(f => f.symbol === 'PG')!;
  assert.equal(statementRoles('<table><tr><td>Cash and cash equivalents</td><td><ix:nonfraction name="us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents" contextref="cash">100</ix:nonfraction></td></tr></table>').size, 0);
  assert.equal(statementRoles(pg.html + pg.html).size, 0);
  assert.equal(normalize(apply(pg, pg.html + pg.html), retrievedAt).current!.values.cash, undefined);
});

test('unclassified short-term borrowings cannot stand in for a complete current-debt subtotal', () => {
  const data = complete();
  delete data.facts['us-gaap'].LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities;
  add(data, 'shortDebt', 20); add(data, 'debtNoncurrent', 180);
  assert.equal(normalize(data, retrievedAt).current!.values.debt, undefined);
});

test('source fallback works through retrieval and remains withheld when source labels are ambiguous or unavailable', async () => {
  const fixture = fixtures.find(f => f.symbol === 'UBER')!;
  async function run(html: string | null) {
    const company: Submissions = { cik: String(fixture.filing.cik), name: 'Uber Technologies, Inc.', sic: '7389', sicDescription: 'Services-Business Services', tickers: ['UBER'], exchanges: ['NYSE'], fiscalYearEnd: '1231', filings: { recent: { form: [fixture.filing.form], accessionNumber: [fixture.filing.accession], filingDate: [fixture.filing.filed], reportDate: [fixture.filing.end], primaryDocument: [fixture.filing.document] } } };
    const read = async (url: string): Promise<Capture> => {
      let value: unknown;
      if (url.includes('company_tickers')) value = { fields: ['cik', 'ticker', 'exchange'], data: [[fixture.filing.cik, 'UBER', 'NYSE']] };
      else if (url.includes('submissions')) value = company;
      else if (url.includes('companyfacts')) value = fixture.facts;
      else if (url.endsWith('index.json')) value = { directory: { item: [{ name: fixture.filing.url.split('/').at(-1) }] } };
      else if (url === fixture.filing.url) value = fixture.xml;
      else if (url === fixture.filing.documentUrl) { if (html === null) throw new Error('Source unavailable'); value = html; }
      else throw new Error('Unexpected URL');
      const body = typeof value === 'string' ? value : JSON.stringify(value);
      return { url, body, retrievedAt, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') };
    };
    return researchFromSec(await createSecService({ read })('UBER'));
  }
  const verified = await run(fixture.html);
  assert.ok(verified.input);
  assert.equal(verified.input.bridge.debt, 12_723_000_000);
  assert.ok(verified.references.some(r => r.name.includes('statement labels') && r.values.sha256));
  for (const html of [fixture.html + fixture.html, null]) {
    const withheld = await run(html);
    assert.equal(withheld.input, null);
    assert.ok(withheld.findings.some(f => f.code === 'MISSING_debt'));
  }
});
