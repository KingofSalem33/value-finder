import type { Assumptions, CompanyFacts, Metric, ModelInput, RawFact } from '../src/lib/types';
import { TAGS } from '../src/lib/normalize';
// Synthetic fixtures are test-only. They are never imported by the application.
export const assumptions: Assumptions = {
  growth1: .08, growth2: .06, growth3: .04, targetMargin: .22,
  salesCapital: 2, terminalSalesCapital: 1, taxRate: .25,
  riskFree: .04, erp: .05, unleveredBeta: 1, debtWeight: .2, debtSpread: .02,
  waccOverride: .09, terminalGrowth: .025, terminalRoic: .12,
  ebitAdjustment: 0, annualExtraInvestment: 0, otherAssets: 0, otherClaims: 0,
  dilution: 0, wcRatio: .05, daRatio: .04,
};
export const input: ModelInput = { revenue: 1000, margin: .2, periodEnd: '2025-12-31', valuationDate: '2026-02-01', bridge: { cash: 100, debt: 200, shares: 10, leaseDebt: 20, minority: 10, preferred: 5, otherAssets: 0, otherClaims: 0 } };
export const retrievedAt = '2026-11-02T00:00:00.000Z';
export function data(): CompanyFacts { return { cik: 1, entityName: 'Test-only business', facts: { 'us-gaap': {} } }; }
export function add(d: CompanyFacts, metric: Metric, val: number, start = '2025-01-01', end = '2025-12-31', options: Partial<RawFact> & { unit?: string; tag?: string } = {}) {
  const tag = options.tag ?? TAGS[metric][0]; const unit = options.unit ?? (metric === 'shares' ? 'shares' : 'USD');
  const fact: RawFact = { val, start, end, form: '10-K', accn: '0000000001-26-000001', filed: '2026-02-01', fy: 2025, fp: 'FY', ...options };
  if (['cash', 'debt', 'debtCurrent', 'debtNoncurrent', 'equity', 'shortDebt'].includes(metric)) delete fact.start;
  const concept = d.facts['us-gaap'][tag] ??= { units: {} }; (concept.units[unit] ??= []).push(fact); return d;
}
export function complete(): CompanyFacts { const d = data(); for (const [metric, value] of Object.entries({ revenue: 1000, ebit: 200, ocf: 160, capex: 50, da: 40, cash: 100, debt: 200, shares: 10, sbc: 15 })) add(d, metric as Metric, value); return d; }
