'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Assumptions, CompanyFacts, Research, Submissions } from '@/lib/types';
import { MODEL_VERSION, marginOfSafety, reverseDcf, scenarios } from '@/lib/valuation';
import { readResearchResponse } from '@/lib/research-stream';
import { TAGS } from '@/lib/normalize';
import { validSnapshot, type SavedValuation as Saved } from '@/lib/snapshot';
import { researchStatus } from '@/lib/status';
import AssumptionEditor from './assumption-editor';
import { Audit, Disclosure, Forecast, History, Sensitivity, Sources, Wacc } from './research-details';
import { money, pct } from './format';

const STORAGE_KEY = 'value-finder-valuations-v3';
export default function ResearchApp() {
  const [symbol, setSymbol] = useState(''); const [research, setResearch] = useState<Research | null>(null);
  const [a, setA] = useState<Assumptions | null>(null); const [mode, setMode] = useState<'auto' | 'analyst'>('auto');
  const [price, setPrice] = useState(''); const [priceDate, setPriceDate] = useState('');
  const [note, setNote] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [saved, setSaved] = useState<Saved[]>([]); const [saveMessage, setSaveMessage] = useState('');
  const [importOpen, setImportOpen] = useState(false); const [files, setFiles] = useState<File[]>([]);
  useEffect(() => { try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); if (Array.isArray(data)) setSaved(data.filter(validSnapshot).slice(0, 10)); } catch { /* An unavailable browser store does not stop research. */ } }, []);
  function accept(r: Research) { setResearch(r); setA(r.assumptions); setMode('auto'); setNote(''); setPrice(''); setPriceDate(''); setSaveMessage(''); }
  async function load(ticker = symbol, imported?: { facts: CompanyFacts; submissions: Submissions }) {
    if (loading) return;
    const clean = ticker.trim().toUpperCase(); setSymbol(clean); setLoading(true); setProgress('Finding company'); setError(''); setResearch(null); setA(null); setSaveMessage('');
    try {
      const response = await fetch(imported ? '/api/research' : `/api/research?symbol=${encodeURIComponent(clean)}`, imported ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: clean, ...imported }) } : { headers: { Accept: 'application/x-ndjson' } });
      const body = await readResearchResponse(response, setProgress);
      accept(body); setSymbol(body.symbol); setImportOpen(false);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  async function importSec() {
    try {
      const parsed = await Promise.all(files.map(async file => JSON.parse(await file.text())));
      const facts = parsed.find(f => f.facts && f.cik) as CompanyFacts | undefined;
      const submissions = parsed.find(f => f.tickers && f.sic) as Submissions | undefined;
      if (!facts || !submissions) throw new Error('Select a companyfacts JSON file and a submissions JSON file for the same company.');
      // Keep only used standard tags to respect Vercel's request limit; do not change facts.
      const tags = new Set(Object.values(TAGS).flat());
      const trimmed: CompanyFacts = { cik: facts.cik, entityName: facts.entityName, facts: Object.fromEntries(Object.entries(facts.facts).filter(([ns]) => ['us-gaap', 'dei'].includes(ns)).map(([ns, concepts]) => [ns, Object.fromEntries(Object.entries(concepts).filter(([tag]) => tags.has(tag)))])), ...(facts.filingFacts ? { filingFacts: facts.filingFacts.filter(f => tags.has(f.tag) || tags.has(f.tag.split(':').at(-1)!)) } : {}) };
      const minimal: Submissions = { cik: submissions.cik, name: submissions.name, sic: submissions.sic, sicDescription: submissions.sicDescription, tickers: submissions.tickers, exchanges: submissions.exchanges, fiscalYearEnd: submissions.fiscalYearEnd, filings: submissions.filings };
      await load(symbol || submissions.tickers[0], { facts: trimmed, submissions: minimal });
    } catch (e) { setError((e as Error).message); }
  }
  const modeled = useMemo(() => {
    if (!research?.input || !a) return null;
    return scenarios(research.input, a);
  }, [research, a]);
  const base = modeled?.base.result ?? null;
  const validPrice = Number.isFinite(Number(price)) && Number(price) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(priceDate) && priceDate <= new Date().toISOString().slice(0, 10);
  const reverse = useMemo(() => base && a && research?.input && validPrice ? { growth: reverseDcf(research.input, a, Number(price)), margin: reverseDcf(research.input, a, Number(price), 'margin') } : null, [research, a, base, price, validPrice]);
  const findings = [...(research?.findings ?? []), ...(base?.findings ?? []), ...(modeled?.base.error ? [{ code: 'INVALID_ASSUMPTIONS', severity: 'error' as const, message: modeled.base.error }] : [])];
  const status = research ? researchStatus(research, base, modeled?.base.error) : 'DATA UNAVAILABLE';
  const publishValue = base && !findings.some(f => f.severity === 'error');
  const safety = base && validPrice ? marginOfSafety(base.perShare, Number(price)) : null;
  function snapshot(): Saved { return { id: crypto.randomUUID(), research: research!, assumptions: a, mode, note, price, priceDate, savedAt: new Date().toISOString() }; }
  function save() {
    if (!research) return;
    if (a && Object.values(a).some(v => v !== null && !Number.isFinite(v))) { setSaveMessage('Complete the numeric assumptions before saving.'); return; }
    const next = [snapshot(), ...saved].slice(0, 10);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setSaved(next); setSaveMessage('Saved on this device.'); } catch { setSaveMessage('The browser store is full or unavailable. Export the JSON file.'); }
  }
  function download() {
    if (a && Object.values(a).some(v => v !== null && !Number.isFinite(v))) { setSaveMessage('Complete the numeric assumptions before export.'); return; }
    const data = { ...snapshot(), results: modeled, reverseDcf: reverse, modelVersion: MODEL_VERSION };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${research!.symbol}-${new Date().toISOString().slice(0, 10)}-valuation.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function restoreExport(file: File | undefined) {
    if (!file) return;
    try { const s: unknown = JSON.parse(await file.text()); if (!validSnapshot(s)) throw new Error('This is not a supported valuation export.'); restore(s); } catch (e) { setError((e as Error).message); }
  }
  function restore(s: Saved) { accept(s.research); setSymbol(s.research.symbol); setA(s.assumptions); setMode(s.mode); setNote(s.note); setPrice(s.price); setPriceDate(s.priceDate); setError(''); }
  const today = new Date().toISOString().slice(0, 10);
  return <div className="app-shell">
    <header><Link className="brand" href="/">Value Finder<span className="brand-dot" /></Link><nav><Link href="/methodology">Methodology</Link></nav></header>
    <main>
      <section className={`search-section ${research ? 'has-result' : ''}`}>
        <h1>Value a business.</h1>
        <form className="search-form" onSubmit={e => { e.preventDefault(); void load(); }}>
          <div className="search-input"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><label className="sr-only" htmlFor="symbol">Stock symbol</label><input id="symbol" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={10} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="Enter stock symbol" required pattern="[A-Za-z][A-Za-z0-9.\-]{0,9}" /></div>
          <button className="primary" type="submit" disabled={loading}>{loading ? 'Researching…' : 'Research'}<span aria-hidden="true">↗</span></button>
        </form>
      </section>
      {loading && <div className="loading" role="status"><span className="loading-line"/>{progress}…</div>}
      {error && <div className="error-box" role="alert"><h2>Research unavailable</h2><p>{error}</p><button onClick={() => setImportOpen(true)}>Import SEC files</button></div>}
      {research && <section className="research" aria-label="Valuation results">
        <div className="company-heading"><div><p className="ticker">{research.symbol} <span>· USD · {research.company.exchanges?.join(', ')}</span></p><h2>{research.company.name}</h2></div><span className={`status ${status === 'INVALID' ? 'invalid' : ''}`}>{status}</span></div>
        <div className="research-dates">Financial statements through {research.current?.end ?? 'unavailable'} · Research {research.retrievedAt.slice(0, 10)}</div>
        <div className="valuation-summary">
          <div><h3>Market price</h3><strong>{validPrice ? money(Number(price)) : '—'}</strong><span>{validPrice ? `${priceDate} · Manual input` : 'Price not supplied'}</span></div>
          <div><h3>Base intrinsic value</h3><strong className="mint">{publishValue ? money(base.perShare) : '—'}</strong><span>USD per listed share</span></div>
          <div><h3>Margin of safety</h3><strong className={safety !== null && safety < 0 ? 'negative' : 'mint'}>{publishValue ? pct(safety) : '—'}</strong><span>{base ? `WACC ${pct(base.wacc)}` : 'Valuation withheld'}</span></div>
        </div>
        {publishValue && modeled && <>
          <div className="scenario-section"><div className="scenario-range">{(['bear', 'base', 'bull'] as const).map(key => <div key={key} className={key}><span>{key[0].toUpperCase() + key.slice(1)}</span><i aria-hidden="true"/><strong>{modeled[key].result && modeled[key].result!.equityValue > 0 ? money(modeled[key].result!.perShare) : '—'}</strong></div>)}</div><div className="market-growth"><span>Market-implied growth</span><strong>{pct(reverse?.growth.value)}</strong><span>Modeled years 1–3</span><strong>{a ? pct(((1 + a.growth1) * (1 + a.growth2) * (1 + a.growth3)) ** (1 / 3) - 1) : '—'}</strong></div></div>
          <Disclosure title="Reverse DCF">
            <table className="compact-table"><tbody><tr><th>Implied constant annual growth, years 1–3</th><td>{pct(reverse?.growth.value)}</td></tr><tr><th>Base forecast years 1–3 CAGR</th><td>{pct(((1 + a!.growth1) * (1 + a!.growth2) * (1 + a!.growth3)) ** (1 / 3) - 1)}</td></tr><tr><th>Market growth less base CAGR</th><td>{pct(reverse?.growth.value == null ? null : reverse.growth.value - (((1 + a!.growth1) * (1 + a!.growth2) * (1 + a!.growth3)) ** (1 / 3) - 1))}</td></tr><tr><th>Required year 10 operating margin</th><td>{pct(reverse?.margin.value)}</td></tr><tr><th>Base year 10 operating margin</th><td>{pct(a!.targetMargin)}</td></tr></tbody></table>
            <p className="method-note">Each calculation changes one operating variable and holds the other assumptions fixed. Growth varies years 1–3 together, then fades toward stable growth by year 10. Required margin varies the target margin alone. These are separate price explanations, not a unique joint forecast.</p>
            {!validPrice && <p>Enter a price and date to calculate market expectations.</p>}{reverse?.growth.reason && <p className="amber">Growth: {reverse.growth.reason}</p>}{reverse?.margin.reason && <p className="amber">Margin: {reverse.margin.reason}</p>}
          </Disclosure>
        </>}
        {!publishValue && <p className="withheld">{research.specialized ? 'This business needs a specialized model. A generic FCFF value is not shown.' : modeled?.base.error ?? 'The required financial inputs are incomplete or inconsistent. A per-share estimate is not shown.'}</p>}
        <Disclosure title="Market price"><div className="price-inputs"><label>Price (USD)<input aria-label="Market price in USD" type="number" min="0.01" step="any" value={price} onChange={e => setPrice(e.target.value)} /></label><label>Price date<input aria-label="Market price date" type="date" max={today} value={priceDate} onChange={e => setPriceDate(e.target.value)} /></label></div>{price && !validPrice && <p className="amber">Enter a positive price and a valid date no later than today.</p>}</Disclosure>
        <Disclosure title="Historical financial statements"><History research={research} a={a}/></Disclosure>
        {base && <Disclosure title="Ten-year projected financial statements"><Forecast result={base}/></Disclosure>}
        {a && <Disclosure title="Discount-rate calculation"><Wacc a={a}/></Disclosure>}
        {a && <Disclosure title="Assumption editor"><AssumptionEditor research={research} assumptions={a} onChange={setA} mode={mode} setMode={setMode} note={note} setNote={setNote}/></Disclosure>}
        {base && a && <Disclosure title="Scenario assumptions"><div className="table-scroll"><table><thead><tr><th>Operating assumption</th><th>Bear</th><th>Base</th><th>Bull</th></tr></thead><tbody>{(['growth1', 'growth2', 'growth3', 'targetMargin', 'salesCapital', 'terminalRoic', 'waccOverride'] as const).map(key => <tr key={key}><th>{({ growth1: 'Year 1 growth', growth2: 'Year 2 growth', growth3: 'Year 3 growth', targetMargin: 'Target operating margin', salesCapital: 'Near-term sales / capital', terminalRoic: 'Terminal ROIC', waccOverride: 'WACC override' })[key]}</th>{(['bear', 'base', 'bull'] as const).map(s => <td key={s}>{key === 'salesCapital' ? modeled![s].assumptions[key].toFixed(2) : key === 'waccOverride' && modeled![s].assumptions[key] === null ? 'Calculated' : pct(modeled![s].assumptions[key])}</td>)}</tr>)}</tbody></table></div><p className="method-note">Bear: growth −3 points, margin −2.5 points, investment productivity ×0.85, WACC +1 point, terminal ROIC −1.5 points. Bull uses the opposite operating changes and productivity ×1.15. These explicit stress policies are applied to this company’s base assumptions. Each case calculates its own ten-year cash flows. They are not probability forecasts.</p>{(['bear', 'bull'] as const).map(s => modeled![s].error && <p className="amber" key={s}>{s}: {modeled![s].error}</p>)}</Disclosure>}
        {base && a && <Disclosure title="Sensitivity matrix"><Sensitivity research={research} a={a}/></Disclosure>}
        <Disclosure title="Financial reconciliation and audit" open={!publishValue}><Audit research={research} a={a} result={base} findings={findings}/></Disclosure>
        <Disclosure title="Source documents"><Sources research={research}/></Disclosure>
        <div className="result-actions"><button onClick={save}>Save valuation</button><button onClick={download}>Export JSON ↗</button><span role="status">{saveMessage}</span></div>
      </section>}
      <section className="workspace-tools">
        {saved.length > 0 && <Disclosure title="Saved valuations"><ul className="saved-list">{saved.map(s => <li key={s.id}><button onClick={() => restore(s)}>{s.research.symbol}<span>{s.savedAt.slice(0, 16).replace('T', ' ')} · {s.mode}</span></button></li>)}</ul></Disclosure>}
        <details className="disclosure" open={importOpen || undefined} onToggle={e => setImportOpen(e.currentTarget.open)}><summary>Import research<span aria-hidden="true">⌄</span></summary><div className="disclosure-body"><div className="import-grid"><div><h3>SEC source files</h3><p>Download the company’s original <a href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces" target="_blank" rel="noreferrer">companyfacts and submissions JSON files</a>. Select both files. The CIK and ticker must match. Imported data stays marked PROVISIONAL.</p><label className="file-label">Choose both SEC JSON files<input aria-label="SEC JSON files" type="file" accept=".json,application/json" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))}/></label><button disabled={loading || files.length !== 2} onClick={() => void importSec()}>Read SEC files</button></div><div><h3>Saved valuation</h3><p>Open an exported valuation to restore its financial inputs, assumptions and price date.</p><label className="file-label">Choose valuation JSON<input aria-label="Saved valuation JSON" type="file" accept=".json,application/json" onChange={e => void restoreExport(e.target.files?.[0])}/></label></div></div></div></details>
      </section>
    </main>
    <footer><span>Value Finder</span><div><Link href="/methodology">Methodology & limits</Link><a href="/source.zip" download>Source code ↗</a></div><p>Research estimates depend on assumptions. This model has not been calibrated to measure valuation accuracy.</p></footer>
  </div>;
}
