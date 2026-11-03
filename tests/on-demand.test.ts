import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createSecService, compressedCache, memoryCache, readSec, selectFilings, type Capture, type SourceCache } from '../src/lib/sec';
import { parseInstance, usedTags, type Filing } from '../src/lib/xbrl';
import { researchFromSec } from '../src/lib/research';
import { marginOfSafety } from '../src/lib/valuation';
import { readResearchResponse } from '../src/lib/research-stream';
import type { CompanyFacts, Submissions } from '../src/lib/types';
import state from '../src/data/collection-state.json';
import { add, complete } from './fixtures';

const filing: Filing = { cik: 1, accession: '0000000001-26-000001', filed: '2026-02-01', form: '10-K', end: '2025-12-31', document: 'test.htm' };
const xml = (extra = '') => `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:us-gaap="http://fasb.org/us-gaap/2025" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><xbrli:context id="c"><xbrli:entity><xbrli:identifier>1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="USD"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><us-gaap:OperatingIncomeLoss contextRef="c" unitRef="USD" decimals="-3">-12500</us-gaap:OperatingIncomeLoss><us-gaap:ShareBasedCompensation contextRef="c" unitRef="USD">0</us-gaap:ShareBasedCompensation>${extra}</xbrli:xbrl>`;

test('runtime parser preserves signs, reported zero, precision and dates; excludes nil and segments', () => {
  const extra = `<us-gaap:IncomeTaxExpenseBenefit contextRef="c" unitRef="USD" xsi:nil="true"/><xbrli:context id="segment"><xbrli:entity><xbrli:identifier>1</xbrli:identifier><xbrli:segment>Segment</xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2025-12-31</xbrli:instant></xbrli:period></xbrli:context><us-gaap:CashAndCashEquivalentsAtCarryingValue contextRef="segment" unitRef="USD">999</us-gaap:CashAndCashEquivalentsAtCarryingValue>`;
  const rows = parseInstance(xml(extra), filing, 'https://www.sec.gov/test.xml', '2026-02-01T00:00:00Z');
  assert.equal(rows.length, 2); assert.equal(rows[0].val, -12500); assert.equal(rows[0].decimals, -3); assert.equal(rows[0].start, '2025-01-01'); assert.equal(rows[1].val, 0);
  assert.throws(() => parseInstance(xml(), { ...filing, cik: 2 }, '', ''), /different company/);
  assert.throws(() => parseInstance('<!DOCTYPE x [<!ENTITY e "10">]>' + xml(), filing, '', ''), /entity declarations/);
});

test('runtime parser agrees with the independent EdgarTools AMD extract for all used source facts', () => {
  const sources = state as Record<string, { sha256: string }>;
  const records = JSON.parse(readFileSync('src/data/research-records.json', 'utf8'));
  const archive = records.AMD.references.find((ref: { name: string }) => ref.name === 'Collected source fact record').url;
  const amd = JSON.parse(gunzipSync(readFileSync('public' + archive)).toString('utf8')) as { facts: CompanyFacts };
  for (const form of ['10-K', '10-Q']) {
    const all = amd.facts.filingFacts!.filter(f => f.form === form).sort((a, b) => b.filed.localeCompare(a.filed));
    const expected = all.filter(f => f.accn === all[0].accn && usedTags.has(f.tag.split(':').at(-1)!));
    const first = expected[0];
    assert.ok(first.url);
    const name = first.url.split('/').at(-1)!;
    const url = Object.keys(sources).find(url => url.endsWith('/' + name))!;
    assert.ok(url, `Archived source missing: ${name}`);
    const body = gunzipSync(readFileSync(`public/filings/${sources[url].sha256}.gz`)).toString('utf8');
    const rows = parseInstance(body, { cik: 2488, accession: first.accn, filed: first.filed, form, end: first.end, document: name }, url, '2026-11-02T00:00:00Z');
    const key = (f: NonNullable<CompanyFacts['filingFacts']>[number]) => JSON.stringify([f.tag, f.unit, f.start ?? null, f.end, f.val, String(f.decimals)]);
    assert.deepEqual(new Set(rows.map(key)), new Set(expected.map(key)));
  }
});

function provider() {
  const facts = complete(); add(facts, 'revenue', 900, '2024-01-01', '2024-12-31', { filed: '2025-02-01' });
  const company: Submissions = { cik: '1', name: 'Test-only operating company', sic: '3571', sicDescription: 'Electronic Computers', tickers: ['NEW'], exchanges: ['Nasdaq'], fiscalYearEnd: '1231', filings: { recent: { form: [filing.form], reportDate: [filing.end], filingDate: [filing.filed], accessionNumber: [filing.accession], primaryDocument: [filing.document] } } };
  const calls: string[] = [];
  const read = async (url: string): Promise<Capture> => {
    calls.push(url);
    let value: unknown;
    if (url.includes('company_tickers')) value = { fields: ['cik', 'ticker', 'exchange'], data: [[1, 'NEW', 'Nasdaq']] };
    else if (url.includes('submissions')) value = company;
    else if (url.includes('companyfacts')) value = facts;
    else if (url.endsWith('index.json')) value = { directory: { item: [{ name: 'test_htm.xml' }] } };
    else if (url.endsWith('test_htm.xml')) value = xml().replace(/<us-gaap:OperatingIncomeLoss[\s\S]*?<\/us-gaap:OperatingIncomeLoss>/, '<us-gaap:PropertyPlantAndEquipmentNet contextRef="c" unitRef="USD">10</us-gaap:PropertyPlantAndEquipmentNet>').replace(/<us-gaap:ShareBasedCompensation[\s\S]*?<\/us-gaap:ShareBasedCompensation>/, '');
    else throw new Error('Unexpected URL: ' + url);
    const body = typeof value === 'string' ? value : JSON.stringify(value);
    return { url, body, bytes: Buffer.byteLength(body), retrievedAt: '2026-11-02T00:00:00Z', sha256: createHash('sha256').update(body).digest('hex') };
  };
  return { read, calls, company, facts };
}

test('an unlisted test symbol retrieves inputs and calculates through the existing engine', async () => {
  const p = provider(); const progress: string[] = [];
  const data = await createSecService(p)('NEW', message => progress.push(message));
  const r = researchFromSec(data, message => progress.push(message));
  assert.equal(r.origin, 'SEC on-demand'); assert.equal(r.symbol, 'NEW'); assert.ok(r.serverScenarios?.base.result);
  assert.ok(r.references.some(ref => ref.name.includes('Company Facts') && ref.values.sha256));
  assert.deepEqual(progress, ['Finding company', 'Retrieving financial statements', 'Checking source filings', 'Checking inputs and calculating value']);
  assert.equal(p.calls.length, 5);
});

test('cache reuses source inputs, preserves source times, isolates callers, and coalesces parallel searches', async () => {
  const p = provider(); const service = createSecService(p);
  const [first, second] = await Promise.all([service('NEW'), service('NEW')]);
  assert.equal(p.calls.length, 5);
  first.facts.facts['us-gaap'] = {};
  assert.ok(Object.keys(second.facts.facts['us-gaap']).length);
  const third = await service('NEW');
  assert.equal(p.calls.length, 5); assert.equal(third.references[0].retrievedAt, '2026-11-02T00:00:00Z');
});

test('failed retrievals do not populate the source cache', async () => {
  const cache = memoryCache(); let calls = 0;
  await assert.rejects(cache('fail', 60, async () => { calls++; throw new Error('Source failure'); }));
  assert.equal(await cache('fail', 60, async () => { calls++; return 10; }), 10); assert.equal(calls, 2);
});

test('large financial inputs fit the persistent cache after compression without changing their values', async () => {
  const input = { rows: Array.from({length:80000}, (_, i) => ({val:i,unit:'USD',end:'2025-12-31',retrievedAt:'2026-11-02T00:00:00Z'})) };
  assert.ok(Buffer.byteLength(JSON.stringify(input)) > 5_000_000);
  const saved = memoryCache(); let storedSize = 0; let reads = 0;
  const store: SourceCache = (key, seconds, work) => saved(key, seconds, async () => { const value = await work(); storedSize = Buffer.byteLength(JSON.stringify(value)); return value; });
  const cache = compressedCache(store);
  assert.deepEqual(await cache('large', 60, async () => { reads++; return input; }), input);
  assert.deepEqual(await cache('large', 60, async () => { reads++; return input; }), input);
  assert.equal(reads, 1); assert.ok(storedSize < 1_500_000);
});

test('incompressible inputs bypass persistence without failing or caching a missing value', async () => {
  const input = { data: randomBytes(2_000_000).toString('base64') }; let reads = 0;
  const cache = compressedCache(memoryCache());
  assert.deepEqual(await cache('huge', 60, async () => { reads++; return input; }), input);
  assert.deepEqual(await cache('huge', 60, async () => { reads++; return input; }), input);
  assert.equal(reads, 2);
});

test('queued SEC requests stop at their deadline and expired slots do not block later requests', async () => {
  const identity = process.env.SEC_USER_AGENT; process.env.SEC_USER_AGENT = 'ValueFinder tests tests@unit.test';
  const calls: number[] = [];
  const spy = mock.method(globalThis, 'fetch', async () => { calls.push(Date.now()); return new Response('{}'); });
  try {
    await readSec('https://data.sec.gov/test.json', AbortSignal.timeout(2000));
    const start = Date.now();
    const stopped = await Promise.allSettled(Array.from({ length: 4 }, () => readSec('https://data.sec.gov/test.json', AbortSignal.timeout(25))));
    assert.ok(Date.now() - start < 450, 'Queue did not stop promptly at the deadline.');
    assert.ok(stopped.every(result => result.status === 'rejected' && result.reason.status === 504));
    await readSec('https://data.sec.gov/test.json', AbortSignal.timeout(1200));
    assert.equal(calls.length, 2); assert.ok(calls[1] - calls[0] >= 500, 'Pacing was lost after aborted requests.');
  } finally { spy.mock.restore(); if (identity === undefined) delete process.env.SEC_USER_AGENT; else process.env.SEC_USER_AGENT = identity; }
});

test('unknown symbols, wrong company identifiers and source failures produce explicit errors', async () => {
  await assert.rejects(createSecService(provider())('MISSING'), /No SEC-listed company/);
  const p = provider(); p.facts.cik = 2;
  await assert.rejects(createSecService(p)('NEW'), /different company/);
  await assert.rejects(createSecService({ read: async () => { throw new Error('Source unavailable'); } })('NEW'), /Source unavailable/);
});

test('a newer reported period cannot silently receive an older annual valuation', async () => {
  const data = await createSecService(provider())('NEW');
  const r = researchFromSec({ ...data, latestPeriod: '2026-06-30' });
  assert.equal(r.input, null); assert.equal(r.serverScenarios, null); assert.ok(r.findings.some(f => f.code === 'LATEST_FILING'));
});

test('current base filings and amendments are selected together by fiscal period', () => {
  const p = provider(); const recent = p.company.filings!.recent;
  recent.form.unshift('10-K/A'); recent.reportDate!.unshift(filing.end); recent.filingDate.unshift('2026-03-01'); recent.accessionNumber.unshift('0000000001-26-000002'); recent.primaryDocument.unshift('amended.htm');
  assert.equal(selectFilings(p.company).length, 2);
});

test('an amendment without extracted XBRL preserves the base model and exposes its review requirement', async () => {
  const p = provider(); const recent = p.company.filings!.recent;
  recent.form.unshift('10-K/A'); recent.reportDate!.unshift(filing.end); recent.filingDate.unshift('2026-03-01'); recent.accessionNumber.unshift('0000000001-26-000002'); recent.primaryDocument.unshift('amended.htm');
  const read = async (url: string) => {
    if (!url.includes('000000000126000002')) return p.read(url);
    const body = JSON.stringify({ directory: { item: [] } });
    return { body, url, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), retrievedAt: '2026-11-02T00:00:00Z' };
  };
  const r = researchFromSec(await createSecService({ read })('NEW'));
  assert.ok(r.serverScenarios?.base.result); assert.ok(r.findings.some(f => f.code === 'AMENDMENT_REVIEW'));
});

test('background cache work does not publish progress to a completed response', async () => {
  const p = provider(); const values = new Map<string, unknown>(); const background: (() => Promise<unknown>)[] = [];
  const cache: SourceCache = async <T>(key: string, _seconds: number, work: () => Promise<T>): Promise<T> => {
    if (values.has(key)) { if (key.startsWith('financials:')) background.push(work); return structuredClone(values.get(key)) as T; }
    const value = await work(); values.set(key, value); return structuredClone(value);
  };
  const service = createSecService({ read: p.read, cache });
  await service('NEW'); let closed = false;
  await service('NEW', () => { if (closed) throw new Error('Response is closed'); }); closed = true;
  assert.equal(background.length, 1); await background[0]();
});

test('margin of safety uses intrinsic value as the denominator and retains a premium', () => {
  assert.ok(Math.abs(marginOfSafety(100, 80)! - .2) < 1e-12);
  assert.equal(marginOfSafety(100, 125), -.25); assert.equal(marginOfSafety(0, 80), null); assert.equal(marginOfSafety(100, NaN), null);
});

test('progress streams support chunk boundaries, source errors and incomplete responses', async () => {
  const progress: string[] = [];
  const data = JSON.stringify({ type: 'progress', message: 'Finding company' }) + '\n' + JSON.stringify({ type: 'result', research: { symbol: 'NEW' } }) + '\n';
  const bytes = new TextEncoder().encode(data);
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 7)); c.enqueue(bytes.slice(7)); c.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  assert.equal((await readResearchResponse(response, message => progress.push(message))).symbol, 'NEW'); assert.deepEqual(progress, ['Finding company']);
  await assert.rejects(readResearchResponse(new Response('{"type":"error","message":"SEC limit reached"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }), () => {}), /SEC limit reached/);
  await assert.rejects(readResearchResponse(new Response('', { headers: { 'Content-Type': 'application/x-ndjson' } }), () => {}), /before a result/);
});
