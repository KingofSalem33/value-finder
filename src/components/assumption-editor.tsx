'use client';
import { useEffect, useState } from 'react';
import type { Assumptions, Research } from '@/lib/types';
import { Disclosure } from './research-details';
import { pct } from './format';
const fields: { key: keyof Assumptions; label: string; percent?: boolean; dollars?: boolean }[] = [
  { key: 'growth1', label: 'Year 1 revenue growth', percent: true }, { key: 'growth2', label: 'Year 2 revenue growth', percent: true }, { key: 'growth3', label: 'Year 3 revenue growth', percent: true },
  { key: 'targetMargin', label: 'Year 10 operating margin', percent: true }, { key: 'salesCapital', label: 'Years 1–3 sales / capital' }, { key: 'terminalSalesCapital', label: 'Year 10 sales / capital' },
  { key: 'taxRate', label: 'Marginal tax rate', percent: true }, { key: 'riskFree', label: 'Risk-free rate', percent: true }, { key: 'erp', label: 'Equity risk premium', percent: true },
  { key: 'unleveredBeta', label: 'Unlevered beta' }, { key: 'debtWeight', label: 'Target debt weight', percent: true }, { key: 'debtSpread', label: 'Borrowing spread', percent: true },
  { key: 'waccOverride', label: 'WACC override', percent: true }, { key: 'terminalGrowth', label: 'Terminal growth', percent: true }, { key: 'terminalRoic', label: 'Terminal ROIC', percent: true },
  { key: 'ebitAdjustment', label: 'Annual EBIT adjustment', dollars: true }, { key: 'annualExtraInvestment', label: 'Extra annual reinvestment', dollars: true },
  { key: 'otherAssets', label: 'Additional nonoperating assets', dollars: true }, { key: 'otherClaims', label: 'Additional financing claims', dollars: true },
  { key: 'dilution', label: 'Annual net dilution', percent: true }, { key: 'wcRatio', label: 'Working capital / revenue', percent: true }, { key: 'daRatio', label: 'D&A / revenue', percent: true },
];
const primaryFields = new Set<keyof Assumptions>(['growth1', 'growth2', 'growth3', 'targetMargin', 'salesCapital', 'taxRate', 'waccOverride', 'terminalGrowth', 'terminalRoic']);
function NumberField({ id, value, scale, disabled, onChange }: { id: keyof Assumptions; value: number | null; scale: number; disabled: boolean; onChange: (value: number | null) => void }) {
  const format = (v: number | null) => v === null || !Number.isFinite(v) ? '' : String(Number((v * scale).toFixed(4)));
  const [text, setText] = useState(() => format(value));
  useEffect(() => { if (value === null || Number.isFinite(value)) setText(format(value)); }, [value, scale]);
  return <input id={id} type="text" inputMode="decimal" disabled={disabled} placeholder={id === 'waccOverride' ? 'Calculated' : undefined} value={text} onChange={e => {
    const raw = e.target.value; setText(raw);
    onChange(raw.trim() === '' && ['waccOverride', 'wcRatio', 'daRatio'].includes(id) ? null : raw.trim() === '' ? NaN : Number(raw) / scale);
  }}/>;
}
export default function AssumptionEditor({ research, assumptions, onChange, mode, setMode, note, setNote }: { research: Research; assumptions: Assumptions; onChange: (a: Assumptions) => void; mode: 'auto' | 'analyst'; setMode: (m: 'auto' | 'analyst') => void; note: string; setNote: (n: string) => void }) {
  function renderFields(selected: typeof fields) {
    return <div className="assumptions-grid">{selected.map(f => {
      const value = assumptions[f.key]; const scale = f.percent ? 100 : f.dollars ? 1e-6 : 1;
      const explanation = research.assumptionNotes.find(n => n.field === f.key);
      return <div className="assumption" key={f.key}>
        <label htmlFor={f.key}>{f.label}{f.percent ? ' (%)' : f.dollars ? ' (USD m)' : ''}</label>
        <NumberField id={f.key} value={value} scale={scale} disabled={mode !== 'analyst'} onChange={value => onChange({ ...assumptions, [f.key]: value })}/>
        {explanation && <details className="input-evidence"><summary>Basis</summary><p>{explanation.explanation}</p>{explanation.source.startsWith('https://') ? <a href={explanation.source} target="_blank" rel="noreferrer">Source</a> : <span>{explanation.source}</span>}</details>}
      </div>;
    })}</div>;
  }
  return <>
    <div className="section-toolbar"><div className="segmented" aria-label="Research mode"><button type="button" aria-pressed={mode === 'auto'} onClick={() => { setMode('auto'); onChange(research.assumptions!); }}>Model defaults</button><button type="button" aria-pressed={mode === 'analyst'} onClick={() => setMode('analyst')}>Edit assumptions</button></div></div>
    {renderFields(fields.filter(f => primaryFields.has(f.key)))}
    <p className="method-note">Years 4–10 growth moves toward {pct(assumptions.terminalGrowth)}. Defaults are model assumptions, not analyst consensus.</p>
    <Disclosure title="Other assumptions">{renderFields(fields.filter(f => !primaryFields.has(f.key)))}</Disclosure>
    {mode === 'analyst' && <><label className="note-label" htmlFor="analyst-note">Adjustment evidence</label><textarea id="analyst-note" rows={3} value={note} onChange={e => setNote(e.target.value)} /></>}
  </>;
}
