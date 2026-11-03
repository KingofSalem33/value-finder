import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { SourceError } from './sources';
import { parseInstance, usedTags, type Filing } from './xbrl';
import reviews from '../data/accounting-review.json';
import type { CompanyFacts, Reference, Submissions } from './types';

export type Progress = (message: string) => void;
export interface Capture { body: string; url: string; sha256: string; retrievedAt: string; bytes: number }
export type SourceCache = <T>(key: string, seconds: number, work: () => Promise<T>) => Promise<T>;
interface Options { read: (url: string, signal: AbortSignal) => Promise<Capture>; cache?: SourceCache }
interface Directory { fields: string[]; data: (string | number | null)[][] }
export interface SecCompany { symbol: string; facts: CompanyFacts; submissions: Submissions; retrievedAt: string; references: Reference[]; latestPeriod: string | null }
let queue = Promise.resolve();
let nextRequest = 0;

/** Keep one process below two SEC requests/second. All requests also have a shared search deadline. */
export async function readSec(url: string, signal: AbortSignal): Promise<Capture> {
  const identity = process.env.SEC_USER_AGENT;
  if (!identity || !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(identity) || identity.includes('example.com')) throw new SourceError('SEC access is not configured. Set the server SEC_USER_AGENT contact.', 503);
  if (!/^https:\/\/(?:www|data)\.sec\.gov\//.test(url)) throw new SourceError('Unsupported source URL.');
  const slot = queue.then(async () => {
    signal.throwIfAborted();
    await delay(Math.max(0, nextRequest - Date.now()), undefined, { signal });
    signal.throwIfAborted(); nextRequest = Date.now() + 550;
  });
  queue = slot.catch(() => {});
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      slot.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  } catch { throw new SourceError('The SEC request queue reached the search deadline. Try again.', 504); }
  let response: Response;
  try { response = await fetch(url, { headers: { 'User-Agent': identity, Accept: 'application/json,application/xml,text/html' }, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: 'no-store', redirect: 'error' }); }
  catch { throw new SourceError('SEC could not be reached before the request deadline. Try the search again.', 504); }
  if (!response.ok) throw new SourceError(`SEC returned HTTP ${response.status}. ${response.status === 429 ? 'Its request limit was reached. Try again later.' : 'The source could not be retrieved. Try again later.'}`, response.status === 429 ? 429 : 502);
  if (Number(response.headers.get('content-length')) > 30_000_000) { await response.body?.cancel(); throw new SourceError('The SEC source exceeds the supported size.'); }
  const reader = response.body?.getReader(); if (!reader) throw new SourceError('The SEC response has no body.');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 30_000_000) { await reader.cancel(); throw new SourceError('The SEC source exceeds the supported size.'); }
      chunks.push(value);
    }
  } catch (error) { if (error instanceof SourceError) throw error; throw new SourceError('The SEC download did not complete. Try the search again.', 504); }
  const body = Buffer.concat(chunks);
  return { body: body.toString('utf8'), url, bytes, sha256: createHash('sha256').update(body).digest('hex'), retrievedAt: new Date().toISOString() };
}

export function memoryCache(): SourceCache {
  const entries = new Map<string, { until: number; value: unknown }>(); const pending = new Map<string, Promise<unknown>>();
  return async <T>(key: string, seconds: number, work: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key); if (hit && hit.until > Date.now()) return structuredClone(hit.value) as T;
    if (pending.has(key)) return structuredClone(await pending.get(key)) as T;
    const task = work().then(value => {
      if (Buffer.byteLength(JSON.stringify(value)) <= 1_500_000) {
        if (entries.size >= 20) entries.delete(entries.keys().next().value!);
        entries.set(key, { until: Date.now() + seconds * 1000, value });
      }
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, task); return structuredClone(await task);
  };
}

/** Store compressed JSON below the framework's 2 MB entry limit; oversized entries remain uncached. */
export function compressedCache(store: SourceCache): SourceCache {
  return async <T>(key: string, seconds: number, work: () => Promise<T>): Promise<T> => {
    let fresh: { value: T } | null = null;
    const packed = await store<string | null>(key, seconds, async () => {
      const value = await work(); fresh = { value };
      const encoded = gzipSync(Buffer.from(JSON.stringify(value))).toString('base64');
      return Buffer.byteLength(encoded) <= 1_500_000 ? encoded : null;
    });
    if (packed === null) return fresh ? (fresh as { value: T }).value : work();
    return JSON.parse(gunzipSync(Buffer.from(packed, 'base64')).toString('utf8')) as T;
  };
}

function json<T>(capture: Capture): T {
  try { return JSON.parse(capture.body) as T; } catch { throw new SourceError('SEC returned an unreadable JSON source.'); }
}
const reference = (name: string, capture: Omit<Capture, 'body'>, asOf: string, extra: Reference['values'] = {}): Reference => ({ name, url: capture.url, asOf, retrievedAt: capture.retrievedAt, values: { sha256: capture.sha256, bytes: capture.bytes, ...extra } });
const metadata = ({ body: _body, ...capture }: Capture) => capture;

export function selectFilings(company: Submissions): Filing[] {
  const r = company.filings?.recent;
  if (!r?.reportDate) return [];
  const filings = r.form.flatMap((form, i) => {
    if (!/^10-[KQ](?:\/A)?$/.test(form) || !/^\d{4}-\d{2}-\d{2}$/.test(r.reportDate![i]) || !/^\d{10}-\d{2}-\d{6}$/.test(r.accessionNumber[i]) || !/^[\w.-]+\.html?$/.test(r.primaryDocument[i])) return [];
    return [{ cik: Number(company.cik), form, end: r.reportDate![i], filed: r.filingDate[i], accession: r.accessionNumber[i], document: r.primaryDocument[i] }];
  }).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const annualEnd = filings.find(f => f.form.startsWith('10-K'))?.end;
  const quarterEnd = filings.find(f => f.form.startsWith('10-Q') && (!annualEnd || f.end > annualEnd))?.end;
  // Keep base filings and amendments for the two periods used in the current run rate.
  const selected = filings.filter(f => f.form.startsWith('10-K') ? f.end === annualEnd : f.end === quarterEnd);
  if (selected.length > 6) throw new SourceError('More than six current-period filings and amendments require filing review.', 422);
  return selected;
}

export function createSecService({ read, cache = memoryCache() }: Options) {
  return async function secData(requestedSymbol: string, progress: Progress = () => {}): Promise<SecCompany> {
    const signal = AbortSignal.timeout(55000);
    const requested = requestedSymbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(requested)) throw new SourceError('Enter a valid US stock symbol.', 400);
    progress('Finding company');
    const directory = await cache('directory', 86400, async () => {
      const capture = await read('https://www.sec.gov/files/company_tickers_exchange.json', signal);
      const value = json<Directory>(capture);
      if (!Array.isArray(value.fields) || !Array.isArray(value.data) || !['cik', 'ticker', 'exchange'].every(f => value.fields.includes(f))) throw new SourceError('The SEC symbol directory format is unsupported.');
      return { value, source: metadata(capture) };
    });
    const { fields, data } = directory.value;
    const tickerColumn = fields.indexOf('ticker'); const cikColumn = fields.indexOf('cik'); const exchangeColumn = fields.indexOf('exchange');
    const row = data.find(row => row[tickerColumn] === requested) ?? data.find(row => row[tickerColumn] === requested.replaceAll('.', '-'));
    if (!row) throw new SourceError('No SEC-listed company was found for this symbol.', 404);
    const symbol = String(row[tickerColumn]); const cik = Number(row[cikColumn]);
    if (!Number.isInteger(cik) || cik <= 0) throw new SourceError('The SEC directory returned an invalid company identifier.');
    if (!/^(?:Nasdaq|NYSE|NYSE American|AMEX|CBOE)$/i.test(String(row[exchangeColumn]))) throw new SourceError('This security is outside the supported US exchange listings.', 422);
    const id = String(cik).padStart(10, '0');
    const submissions = await cache(`submissions:${id}`, 300, async () => {
      const capture = await read(`https://data.sec.gov/submissions/CIK${id}.json`, signal);
      const value = json<Submissions>(capture);
      if (Number(value.cik) !== cik || !Array.isArray(value.tickers) || !value.tickers.includes(symbol) || !value.filings?.recent || !Array.isArray(value.filings.recent.form)) throw new SourceError('SEC submissions do not match the requested symbol and company.');
      return { value, source: metadata(capture) };
    });
    // A second ticker mapped to the same CIK still needs its own identity check on a cache hit.
    if (!submissions.value.tickers.includes(symbol)) throw new SourceError('The symbol is not a current listed security for this company.', 422);
    const selected = selectFilings(submissions.value);
    const recent = submissions.value.filings!.recent;
    const latestPeriod = recent.form.flatMap((form, i) => /^10-[KQ](?:\/A)?$/.test(form) && /^\d{4}-\d{2}-\d{2}$/.test(recent.reportDate?.[i] ?? '') ? [recent.reportDate![i]] : []).sort().at(-1) ?? null;
    const foreign = recent.form.some(f => ['20-F', '40-F'].includes(f));
    const specialized = Number(submissions.value.sic) >= 6000 && Number(submissions.value.sic) <= 6799;
    const fingerprint = createHash('sha256').update(JSON.stringify({ selected, foreign, specialized })).digest('hex');
    progress('Retrieving financial statements');
    const financials = await cache(`financials:${id}:${fingerprint}`, 3600, async () => {
      const capture = await read(`https://data.sec.gov/api/xbrl/companyfacts/CIK${id}.json`, signal);
      const original = json<CompanyFacts>(capture);
      if (Number(original.cik) !== cik || !original.facts || typeof original.facts !== 'object') throw new SourceError('The SEC financial facts identify a different company or have an unsupported format.');
      const facts: CompanyFacts = { cik, entityName: original.entityName, facts: {}, filingFacts: [] };
      for (const namespace of ['us-gaap', 'dei']) {
        facts.facts[namespace] = {};
        for (const [tag, concept] of Object.entries(original.facts[namespace] ?? {})) {
          if (!usedTags.has(tag)) continue;
          facts.facts[namespace][tag] = { ...concept, units: Object.fromEntries(Object.entries(concept.units).map(([unit, entries]) => [unit, entries.map(f => ({ ...f, retrievedAt: capture.retrievedAt }))])) };
        }
      }
      const references = [reference('SEC — Company Facts', capture, latestPeriod ?? capture.retrievedAt.slice(0, 10))];
      if (!foreign && !specialized) {
        for (const filing of selected) {
          const folder = `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accession.replaceAll('-', '')}/`;
          const extracted = await cache(`instance:${filing.accession}`, 30 * 86400, async () => {
            const indexSource = await read(`${folder}index.json`, signal);
            const index = json<{ directory: { item: { name: string }[] } }>(indexSource);
            const expected = filing.document.replace(/\.htm(l)?$/, '_htm$1.xml');
            const files = (index.directory?.item ?? []).map(f => f.name).filter(name => /^[\w.-]+_(?:htm|html)\.xml$/.test(name));
            const name = files.find(name => name === expected) ?? (files.length === 1 ? files[0] : null);
            if (!name) {
              if (filing.form.endsWith('/A')) return { rows: [], source: metadata(indexSource), amendmentWithoutInstance: true };
              throw new SourceError('The extracted XBRL instance could not be identified in the SEC filing.');
            }
            const instance = await read(folder + name, signal);
            let rows: NonNullable<CompanyFacts['filingFacts']>;
            try { rows = parseInstance(instance.body, filing, instance.url, instance.retrievedAt); } catch (error) { throw new SourceError(`The source filing requires accounting review: ${(error as Error).message}`, 422); }
            return { rows, source: metadata(instance), amendmentWithoutInstance: false };
          });
          facts.filingFacts!.push(...extracted.rows);
          references.push(reference(`SEC — ${filing.form} — ${filing.end}`, extracted.source, filing.end, { accession: filing.accession, filed: filing.filed, ...(extracted.amendmentWithoutInstance ? { review: 'This amendment has no extracted XBRL instance. Base filing facts and Company Facts are used. Review the amendment for financial changes.' } : {}) }));
        }
        // Dated qualitative rules require their original disclosure and accession on every new bundle.
        for (const rule of reviews.filter(rule => rule.cik === cik && rule.end === latestPeriod && recent.accessionNumber.includes(rule.accn) && recent.filingDate[recent.accessionNumber.indexOf(rule.accn)] === rule.filed)) {
          const disclosure = await read(rule.url, signal);
          const plain = disclosure.body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
          if (!plain.toLowerCase().includes(rule.requiredText.toLowerCase())) throw new SourceError('The dated accounting disclosure could not be verified.', 422);
          const { symbol: _symbol, cik: _cik, requiredText: _required, ...fact } = rule;
          facts.filingFacts!.push({ ...fact, retrievedAt: disclosure.retrievedAt });
          references.push(reference('SEC — dated accounting disclosure', disclosure, rule.end, { accession: rule.accn, filed: rule.filed }));
        }
      }
      return { facts, references };
    });
    progress('Checking source filings');
    return { symbol, facts: financials.facts, submissions: submissions.value, latestPeriod, retrievedAt: new Date().toISOString(), references: [reference('SEC — symbol directory', directory.source, directory.source.retrievedAt.slice(0, 10)), reference('SEC — submissions', submissions.source, latestPeriod ?? submissions.source.retrievedAt.slice(0, 10)), ...financials.references] };
  };
}
