import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import coverage from '../src/data/coverage.json';
import industryMap from '../src/data/industry-map.json';
import type { Reference, ReferenceSet } from '../src/lib/types';

const NYU = 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/';
const DAY = 86400000;
const rows = (html: string) => { const $ = cheerio.load(html); return $('tr').toArray().map(row => $(row).find('td,th').toArray().map(cell => $(cell).text().replace(/\s+/g, ' ').trim())); };
const plain = (html: string) => cheerio.load(html).text().replace(/\s+/g, ' ');
function numeric(text: string) {
  if (!text?.trim() || /NA|N\/A/i.test(text)) throw new Error('Missing reference number.');
  const value = Number(text.replaceAll(',', '').replaceAll('$', '').replaceAll('%', ''));
  if (!Number.isFinite(value)) throw new Error('Invalid reference number.');
  return text.includes('%') ? value / 100 : value;
}
function pageDate(html: string) {
  const match = plain(html).match(/(?:as of|updated:|Date:)\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{1,2},?\s*)?(20\d{2})/i);
  if (!match) throw new Error('Reference date is unavailable.');
  return `${match[1]} ${match[2] ?? ''}${match[3]}`.trim();
}

export function parseTreasury(xml: string, today: string) {
  const observations = [...xml.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g)].flatMap(([, entry]) => {
    const date = entry.match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/);
    const rate = entry.match(/<d:BC_10YEAR[^>]*>([\d.]+)<\//);
    return date && rate && date[1] <= today ? [{ date: date[1], rate: Number(rate[1]) / 100 }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const latest = observations.at(-1);
  if (!latest || !Number.isFinite(latest.rate) || latest.rate <= 0 || Date.parse(today) - Date.parse(latest.date) > 10 * DAY) throw new Error('A recent Treasury observation is unavailable.');
  return latest;
}

export function parseImpliedErp(html: string, today: string) {
  const text = plain(html);
  const match = text.match(/Implied ERP on\s*([A-Za-z]+\s+\d{1,2},?\s+20\d{2})\s*=\s*([\d.]+)%\s*\(Trailing 12 month,? with adjusted payout\)/i);
  if (!match) throw new Error('The dated monthly adjusted-payout implied ERP could not be identified.');
  const date = new Date(`${match[1]} UTC`).toISOString().slice(0, 10);
  const erp = Number(match[2]) / 100;
  if (date > today || Date.parse(today) - Date.parse(date) > 62 * DAY || erp <= 0 || erp > .2) throw new Error('Monthly ERP date or value is outside supported bounds.');
  const sourceRate = text.slice(match.index, (match.index ?? 0) + 1600).match(/US treasury rate of\s*([\d.]+)%/i);
  return { date, erp, ...(sourceRate ? { sourceTreasury: Number(sourceRate[1]) / 100 } : {}) };
}

export function parseCreditTable(html: string) {
  const all = rows(html);
  const start = all.findIndex(row => row[0] === 'For large non-financial service firms');
  if (start < 0) throw new Error('Large nonfinancial-firm credit table is unavailable.');
  const table: NonNullable<ReferenceSet['creditSpreads']> = [];
  for (const row of all.slice(start + 1)) {
    if (table.length && !row[0]) break;
    if (!/^-?\d/.test(row[0] ?? '') || !row[3]?.includes('%')) continue;
    table.push({ lower: numeric(row[0]), rating: row[2], spread: numeric(row[3]) });
  }
  if (table.length < 10 || !table.some(row => row.rating.includes('AAA'))) throw new Error('Synthetic credit table is incomplete.');
  return table;
}

interface Capture { sha256: string; retrievedAt: string; etag?: string | null; lastModified?: string | null; bytes: number }
async function main() {
  let state: Record<string, Capture> = {};
  try { state = JSON.parse(await readFile('src/data/reference-state.json', 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  await mkdir('public/filings', { recursive: true });
  const pending = new Map<string, Promise<{ text: string; capture: Capture }>>();
  async function capture(url: string, maxAge: number) {
    const active = pending.get(url); if (active) return active;
    const work = (async () => {
      const old = state[url];
      const oldBody = old ? await readFile(`public/filings/${old.sha256}.gz`).then(gunzipSync).catch(() => null) : null;
      if (oldBody && createHash('sha256').update(oldBody).digest('hex') !== old.sha256) throw new Error('A reference archive failed its hash check.');
      if (old && oldBody && Date.now() - Date.parse(old.retrievedAt) < maxAge) return { text: oldBody.toString('utf8'), capture: old };
      const headers: Record<string, string> = { 'User-Agent': 'ValueFinder financial research', Accept: 'text/html,text/xml,text/csv' };
      if (old?.etag && oldBody) headers['If-None-Match'] = old.etag;
      if (old?.lastModified && oldBody) headers['If-Modified-Since'] = old.lastModified;
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(35000) });
      if (response.status === 304 && old && oldBody) return { text: oldBody.toString('utf8'), capture: old };
      if (!response.ok) throw new Error(`Reference HTTP ${response.status}: ${new URL(url).hostname}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 10_000_000) throw new Error('Reference exceeds 10 MB.');
      const sha256 = createHash('sha256').update(body).digest('hex');
      const value = { sha256, retrievedAt: new Date().toISOString(), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), bytes: body.length };
      await writeFile(`public/filings/${sha256}.gz`, gzipSync(body));
      state[url] = value;
      return { text: body.toString('utf8'), capture: value };
    })();
    pending.set(url, work); return work;
  }
  const today = new Date().toISOString().slice(0, 10);
  const treasuryUrl = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${today.slice(0, 4)}`;
  const treasury = await capture(treasuryUrl, 20 * 3600000);
  const observation = parseTreasury(treasury.text, today);
  const countryUrl = `${NYU}datafile/ctryprem.html`;
  const homeUrl = `${NYU}home.htm`;
  const ratingsUrl = `${NYU}datafile/ratings.html`;
  const country = await capture(countryUrl, 14 * DAY);
  const home = await capture(homeUrl, DAY);
  const ratings = await capture(ratingsUrl, 14 * DAY);
  const us = rows(country.text).find(row => row[0] === 'United States');
  if (!us || us.length < 6) throw new Error('US marginal tax reference is unavailable.');
  const marginalTax = numeric(us[5]);
  const implied = parseImpliedErp(home.text, today);
  const creditSpreads = parseCreditTable(ratings.text);
  const pages: Record<string, Awaited<ReturnType<typeof capture>>> = {};
  for (const page of ['Betas', 'margin', 'roc', 'capex', 'wacc']) pages[page] = await capture(`${NYU}datafile/${page}.html`, 14 * DAY);
  const reference = (name: string, url: string, asOf: string, source: Capture, values: Reference['values']): Reference => ({ name, url, asOf, retrievedAt: source.retrievedAt, values: { ...values, sha256: source.sha256, archive: `/filings/${source.sha256}.gz` } });
  const snapshot: Record<string, ReferenceSet> = {};
  for (const name of new Set([...Object.values(coverage).map(p => p.industry), ...industryMap.map(p => p.industry)])) {
    const r = Object.fromEntries(Object.entries(pages).map(([page, source]) => {
      const row = rows(source.text).find(row => row[0] === name);
      if (!row) throw new Error(`Industry ${name} is absent from ${page}.`);
      return [page, row];
    }));
    const industry = { name, unleveredBeta: numeric(r.Betas[5]), debtEquity: numeric(r.Betas[3]), margin: numeric(r.margin[5]), roic: numeric(r.roc[8]), salesCapital: numeric(r.capex[9]), costDebt: numeric(r.wacc[6]) };
    if (industry.unleveredBeta <= 0 || industry.salesCapital <= 0 || industry.debtEquity < 0 || industry.costDebt <= 0 || marginalTax < 0 || marginalTax > .6) throw new Error(`Industry or tax reference is outside supported bounds: ${name}.`);
    const references: Reference[] = [
      reference('US Treasury — 10-year par yield', treasuryUrl, observation.date, treasury.capture, { treasury: observation.rate, convention: 'Unadjusted US Treasury proxy' }),
      reference('Damodaran — US marginal tax', countryUrl, pageDate(country.text), country.capture, { marginalTax }),
      ...['Betas', 'margin', 'roc', 'capex'].map(page => reference(`Damodaran — ${name} — ${page}`, `${NYU}datafile/${page}.html`, pageDate(pages[page].text), pages[page].capture, { industry: name, ...(page === 'Betas' ? { unleveredBeta: industry.unleveredBeta, debtEquity: industry.debtEquity } : page === 'margin' ? { margin: industry.margin } : page === 'roc' ? { roic: industry.roic } : { salesCapital: industry.salesCapital }) })),
      reference('Damodaran — monthly implied ERP', homeUrl, implied.date, home.capture, { erp: implied.erp, variant: 'Trailing 12 month, adjusted payout; US Treasury convention', ...(implied.sourceTreasury !== undefined ? { sourceTreasury: implied.sourceTreasury } : {}) }),
      reference('Damodaran — synthetic credit spreads', ratingsUrl, pageDate(ratings.text), ratings.capture, { table: 'Large nonfinancial service firms', spreads: JSON.stringify(creditSpreads) }),
      reference(`Damodaran — ${name} — borrowing cost`, `${NYU}datafile/wacc.html`, pageDate(pages.wacc.text), pages.wacc.capture, { costDebt: industry.costDebt }),
    ];
    snapshot[name] = { industry, references, riskFree: observation.rate, erp: implied.erp, marginalTax, creditSpreads };
    console.log(`${name}: Treasury ${observation.date}; ERP ${implied.date}`);
  }
  await writeFile('src/data/reference-snapshot.json.tmp', JSON.stringify(snapshot, null, 2) + '\n');
  await rename('src/data/reference-snapshot.json.tmp', 'src/data/reference-snapshot.json');
  await writeFile('src/data/reference-state.json', JSON.stringify(state, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
