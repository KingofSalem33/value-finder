import type { Assumptions, Research } from './types';
import { MODEL_VERSION } from './valuation';
export interface SavedValuation { id: string; research: Research; assumptions: Assumptions | null; mode: 'auto' | 'analyst'; note: string; price: string; priceDate: string; savedAt: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finiteFields = (v: unknown, fields: string[]) => record(v) && fields.every(f => typeof v[f] === 'number' && Number.isFinite(v[f]));
function evidence(v: unknown, depth = 0): boolean {
  if (depth > 4 || !record(v) || typeof v.value !== 'number' || !Number.isFinite(v.value) || !['url', 'tag', 'unit', 'end', 'filed', 'accession', 'form', 'retrievedAt'].every(key => typeof v[key] === 'string') || !String(v.url).startsWith('https://')) return false;
  return v.derivedFrom === undefined || Array.isArray(v.derivedFrom) && v.derivedFrom.every(f => evidence(f, depth + 1));
}
export function validSnapshot(v: unknown): v is SavedValuation {
  if (!record(v) || !record(v.research)) return false;
  const r = v.research;
  if (r.version !== MODEL_VERSION || typeof r.symbol !== 'string' || !record(r.company) || typeof r.company.name !== 'string' || !Array.isArray(r.company.exchanges) || !r.company.exchanges.every(e => typeof e === 'string')) return false;
  if (!Array.isArray(r.periods) || !Array.isArray(r.findings) || !Array.isArray(r.references) || !Array.isArray(r.assumptionNotes) || typeof r.retrievedAt !== 'string' || !Number.isFinite(Date.parse(r.retrievedAt)) || typeof r.inputDigest !== 'string') return false;
  if (!r.findings.every(f => record(f) && typeof f.code === 'string' && typeof f.message === 'string' && ['info', 'warning', 'error'].includes(String(f.severity)))) return false;
  const periods = [...r.periods as unknown[], ...(r.current ? [r.current] : [])];
  if (!periods.every(p => record(p) && typeof p.end === 'string' && record(p.values) && Object.values(p.values).every(f => evidence(f)))) return false;
  if (!r.references.every(ref => record(ref) && typeof ref.name === 'string' && typeof ref.url === 'string' && record(ref.values))) return false;
  if (!r.assumptionNotes.every(n => record(n) && typeof n.explanation === 'string' && typeof n.source === 'string')) return false;
  if (r.input !== null && (!finiteFields(r.input, ['revenue', 'margin']) || !record(r.input) || !finiteFields(r.input.bridge, ['cash', 'debt', 'shares', 'leaseDebt', 'minority', 'preferred', 'otherAssets', 'otherClaims']))) return false;
  const fields = ['growth1', 'growth2', 'growth3', 'targetMargin', 'salesCapital', 'terminalSalesCapital', 'taxRate', 'riskFree', 'erp', 'unleveredBeta', 'debtWeight', 'debtSpread', 'terminalGrowth', 'terminalRoic', 'ebitAdjustment', 'annualExtraInvestment', 'otherAssets', 'otherClaims', 'dilution'];
  if (v.assumptions !== null && (!finiteFields(v.assumptions, fields) || !record(v.assumptions) || !(v.assumptions.waccOverride === null || typeof v.assumptions.waccOverride === 'number'))) return false;
  const assumptions = v.assumptions;
  if (record(assumptions) && !['wcRatio', 'daRatio'].every(key => assumptions[key] === null || typeof assumptions[key] === 'number' && Number.isFinite(assumptions[key]))) return false;
  return ['auto', 'analyst'].includes(String(v.mode)) && ['note', 'price', 'priceDate', 'savedAt', 'id'].every(k => typeof v[k] === 'string');
}
