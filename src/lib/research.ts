import { createHash } from 'node:crypto';
import { normalize, daysBetween, includesFinanceLeases, includesShortDebt } from './normalize';
import { industryName, SourceError } from './sources';
import { discountRate, MODEL_VERSION, scenarios } from './valuation';
import coverage from '../data/coverage.json';
import referenceSnapshots from '../data/reference-snapshot.json';
import records from '../data/research-records.json';
import type { Assumptions, AssumptionNote, CompanyFacts, Period, ReferenceSet, Research, Submissions } from './types';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const median = (values: number[]) => { const v = [...values].sort((a, b) => a - b); const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
export interface CollectedCompany {
  schemaVersion: number; collectorVersion: string; parserVersion: string;
  symbol: string; facts: CompanyFacts; submissions: Submissions; retrievedAt: string;
  documents: { url: string; sha256: string; retrievedAt: string; bytes: number; periodEnd?: string; filed?: string; form?: string }[];
}

// Search reads accepted records. Financial providers are not called here.
export async function buildResearch(symbol: string, imported?: { facts: CompanyFacts; submissions: Submissions }): Promise<Research> {
  if (imported) {
    const name = industryName(symbol, Number(imported.submissions.sic));
    const refs = name ? (referenceSnapshots as unknown as Record<string, ReferenceSet>)[name] : null;
    return createResearch(symbol, { ...imported, retrievedAt: new Date().toISOString() }, refs, true);
  }
  const stored = (records as unknown as Record<string, Research>)[symbol];
  if (!stored) throw new SourceError('Research has not been collected for this symbol. Current coverage: AMD, AAPL, MSFT, CAT, TXN, AGX and AMZN.', 404);
  if (stored.version !== MODEL_VERSION) throw new SourceError('This research record requires a model refresh.', 503);
  const r: Research = structuredClone(stored);
  const age = daysBetween(r.retrievedAt.slice(0, 10), new Date().toISOString().slice(0, 10)) - 1;
  if (age > 2) r.findings.push({ code: 'COLLECTION_AGE', severity: 'warning', message: `The last accepted collection is ${age} days old. The displayed dates and saved assumptions belong to that collection.` });
  return r;
}

export function observedGrowth(current: Period, periods: Period[]) {
  if (current.kind === 'ttm') {
    const components = current.values.revenue?.derivedFrom;
    if (components?.length === 3 && components[2].value > 0) return { value: components[1].value / components[2].value - 1, basis: `Fiscal YTD ${components[1].start} to ${components[1].end} versus ${components[2].start} to ${components[2].end}`, source: components[1].url };
  }
  const previous = periods.filter(p => p.end < current.end).at(-1);
  if (previous?.values.revenue && current.values.revenue && previous.values.revenue.value > 0 && Math.abs(daysBetween(previous.end, current.end) - 366) <= 8) return { value: current.values.revenue.value / previous.values.revenue.value - 1, basis: 'Latest full fiscal year versus the preceding comparable full fiscal year', source: current.values.revenue.url };
  return null;
}

// The same accounting and forecast owner serves the collector and source imports.
export function createResearch(symbol: string, raw: { facts: CompanyFacts; submissions: Submissions; retrievedAt: string }, refs: ReferenceSet | null, userImport = false): Research {
  const { facts, submissions: company, retrievedAt } = raw;
  if (!company || typeof company.name !== 'string' || !Array.isArray(company.tickers) || !company.tickers.includes(symbol) || Number(company.cik) !== Number(facts.cik)) throw new Error('The source CIK and submissions symbol must identify the same company.');
  const { periods, current, findings } = normalize(facts, retrievedAt);
  const profile = (coverage as Record<string, { cik: number; industry: string; specialized?: string }>)[symbol];
  const sic = Number(company.sic);
  const specialized = !!profile?.specialized || (sic >= 6000 && sic <= 6799) || /bank|insurance|real estate investment trust/i.test(company.sicDescription ?? '');
  if (specialized) findings.push({ code: 'SPECIALIZED', severity: 'error', message: profile?.specialized ?? 'SPECIALIZED VALUATION REQUIRED. This business requires a model other than generic operating-company FCFF.' });
  if (userImport) findings.push({ code: 'USER_IMPORT', severity: 'warning', message: 'User-supplied SEC JSON. Origin and completeness have not been authenticated by the server.' });
  if (!company.exchanges?.some(e => /Nasdaq|NYSE|AMEX|CBOE/i.test(e))) findings.push({ code: 'LISTING', severity: 'error', message: 'A supported US exchange listing could not be verified.' });
  if (company.tickers.length !== 1) findings.push({ code: 'SHARE_CLASSES', severity: 'error', message: 'Multiple listed securities require verification of the common-share basis before valuation.' });
  if (company.filings?.recent.form.some(f => ['20-F', '40-F'].includes(f))) findings.push({ code: 'FOREIGN_ISSUER', severity: 'error', message: 'Foreign issuers and ADRs require verified currency and depositary ratios.' });
  const metadata: Submissions = { cik: company.cik, name: company.name, sic: company.sic, sicDescription: company.sicDescription, tickers: company.tickers, exchanges: company.exchanges, fiscalYearEnd: company.fiscalYearEnd, entityType: company.entityType };
  const result: Research = { version: MODEL_VERSION, symbol, company: metadata, retrievedAt, origin: userImport ? 'User import' : 'SEC collection', inputDigest: createHash('sha256').update(JSON.stringify({ facts, company })).digest('hex'), periods, current, findings, references: [], industry: null, assumptions: null, assumptionNotes: [], input: null, specialized, serverScenarios: null };
  if (specialized || !current || findings.some(f => f.severity === 'error')) return result;
  if (!industryName(symbol, sic)) { findings.push({ code: 'INDUSTRY_UNMAPPED', severity: 'error', message: 'This industry needs a reviewed reference mapping.' }); return result; }
  if (!refs?.industry) { findings.push({ code: 'REFERENCE_UNAVAILABLE', severity: 'error', message: 'No accepted industry and discount-rate reference set is available.' }); return result; }
  result.references = [...refs.references];
  result.industry = refs.industry;
  const industry = refs.industry;
  findings.push({ code: 'DATED_REFERENCE_CAPTURE', severity: 'info', message: `Discount-rate and industry inputs use dated source captures. Treasury observation: ${refs.references[0].asOf}. All source dates are retained.` });
  const rateAge = daysBetween(refs.references[0].asOf, retrievedAt.slice(0, 10)) - 1;
  if (rateAge > 10) findings.push({ code: 'STALE_REFERENCES', severity: 'warning', message: `The Treasury observation is ${rateAge} days old. Review the discount rate before using this estimate.` });
  const erpSourceRate = refs.references.find(ref => ref.name.includes('monthly implied ERP'))?.values.sourceTreasury;
  if (typeof erpSourceRate === 'number' && Math.abs(erpSourceRate - refs.riskFree) > .0025) findings.push({ code: 'ERP_RATE_DATE', severity: 'warning', message: `The monthly ERP source used a ${(erpSourceRate * 100).toFixed(2)}% Treasury rate. This model uses ${(refs.riskFree * 100).toFixed(2)}%. The published monthly ERP has not been refitted to today's yield. Review the date difference and WACC sensitivity.` });
  const v = current.values;
  const revenue = v.revenue!.value;
  const margin = v.ebit!.value / revenue;
  const recent = periods.slice(-4);
  const growthHistory = recent.slice(1).flatMap((p, i) => p.values.revenue && recent[i].values.revenue && recent[i].values.revenue!.value > 0 && Math.abs(daysBetween(recent[i].end, p.end) - 366) <= 8 ? [p.values.revenue.value / recent[i].values.revenue!.value - 1] : []);
  const trend = observedGrowth(current, periods);
  if (!growthHistory.length || !trend) { findings.push({ code: 'SHORT_HISTORY', severity: 'error', message: 'Comparable annual history and an observed same-period growth rate are required.' }); return result; }
  const historicGrowth = median(growthHistory);
  const growth1 = clamp((historicGrowth + trend.value) / 2, -.2, .4);
  const targetMargin = clamp(margin * .75 + industry.margin * .25, .02, .5);
  const debtEvidence = v.debt!;
  const debt = debtEvidence.value + (includesShortDebt(debtEvidence) ? 0 : v.shortDebt?.value ?? 0);
  const financeLeases = (includesFinanceLeases(debtEvidence, 'current') ? 0 : v.financeLeaseCurrent?.value ?? 0) + (includesFinanceLeases(debtEvidence, 'noncurrent') ? 0 : v.financeLeaseNoncurrent?.value ?? 0);
  const missingClaims = ['minority', 'preferred', ...(!includesShortDebt(debtEvidence) && debtEvidence.tag !== 'review:DebtFree' ? ['shortDebt'] : []), ...(!includesFinanceLeases(debtEvidence, 'current') ? ['financeLeaseCurrent'] : []), ...(!includesFinanceLeases(debtEvidence, 'noncurrent') ? ['financeLeaseNoncurrent'] : [])].filter(metric => !v[metric as keyof typeof v]);
  if (missingClaims.length) findings.push({ code: 'CLAIM_COVERAGE', severity: 'warning', message: `Unverified claims are excluded as provisional assumptions: ${missingClaims.join(', ')}. These are not reported zeros. Add supported omitted claims in Analyst Mode.` });
  const bridge = { cash: v.cash!.value, debt, shares: v.shares!.value, leaseDebt: financeLeases, minority: v.minority?.value ?? 0, preferred: v.preferred?.value ?? 0, otherAssets: 0, otherClaims: 0 };
  const capitalRatios = recent.flatMap(p => p.workingCapital !== null && p.values.ppe && p.values.revenue && p.workingCapital + p.values.ppe.value > 0 ? [p.values.revenue.value / (p.workingCapital + p.values.ppe.value)] : []);
  const companyCapital = capitalRatios.length >= 2 ? median(capitalRatios) : null;
  const salesCapital = companyCapital !== null && companyCapital >= .2 && companyCapital <= 20 ? companyCapital : industry.salesCapital;
  const interest = v.interest ?? v.interestPaid;
  const coverageRatio = interest && interest.value > 0 ? Math.max(0, v.ebit!.value) / interest.value : null;
  // Use the large-firm table only when a reported public float establishes its size.
  const floatFacts = (facts.filingFacts ?? []).filter(f => f.tag === 'dei:EntityPublicFloat' && f.unit === 'USD' && f.end <= current.end).sort((a, b) => b.end.localeCompare(a.end));
  const largeFirm = (floatFacts[0]?.val ?? 0) >= 5e9;
  const credit = largeFirm && coverageRatio !== null ? refs.creditSpreads?.filter(row => coverageRatio >= row.lower).sort((a, b) => b.lower - a.lower)[0] : null;
  const debtSpread = debt === 0 && financeLeases === 0 ? 0 : credit?.spread ?? (industry.costDebt !== undefined ? Math.max(0, industry.costDebt - refs.riskFree) : null);
  if (debtSpread === null) { findings.push({ code: 'BORROWING_COST', severity: 'error', message: 'No supported company credit estimate or dated industry borrowing-cost reference is available.' }); return result; }
  if (!credit && debt > 0) findings.push({ code: 'CREDIT_FALLBACK', severity: 'warning', message: 'Borrowing cost uses the dated industry reference. A company-specific current yield is not verified.' });
  if (interest?.metric === 'interestPaid') findings.push({ code: 'CASH_INTEREST_PROXY', severity: 'warning', message: 'Synthetic credit coverage uses disclosed cash interest as a proxy for interest expense. Classification and capitalized interest require review.' });
  const a: Assumptions = {
    growth1, growth2: growth1 * .8 + .025 * .2, growth3: growth1 * .6 + .025 * .4,
    targetMargin, salesCapital, terminalSalesCapital: 1,
    taxRate: refs.marginalTax, riskFree: refs.riskFree, erp: refs.erp, unleveredBeta: industry.unleveredBeta,
    debtWeight: debt === 0 && financeLeases === 0 ? 0 : industry.debtEquity / (1 + industry.debtEquity), debtSpread, waccOverride: null,
    terminalGrowth: .025, terminalRoic: .10, ebitAdjustment: 0, annualExtraInvestment: 0,
    otherAssets: 0, otherClaims: 0, dilution: 0,
    wcRatio: current.workingCapital === null ? null : clamp(current.workingCapital / revenue, -.2, .3),
    daRatio: v.da ? clamp(v.da.value / revenue, 0, .3) : null,
  };
  const wacc = discountRate(a).calculated;
  a.terminalRoic = Math.max(wacc, Math.min(industry.roic, wacc + .02));
  a.terminalSalesCapital = a.terminalRoic / (a.targetMargin * (1 - a.taxRate));
  const historicalInvestment = v.da ? v.capex!.value - v.da.value : null;
  const modeledTotal = Math.max(0, revenue * a.growth1) / a.salesCapital;
  if (historicalInvestment !== null) a.annualExtraInvestment = Math.max(0, historicalInvestment - modeledTotal);
  if (a.daRatio === null || a.wcRatio === null) findings.push({ code: 'INVESTMENT_SPLIT', severity: 'warning', message: 'D&A or complete operating working capital is unavailable. Unavailable forecast components remain blank. Total reinvestment uses the disclosed sales-to-capital assumption.' });
  if (companyCapital === null) findings.push({ code: 'CAPITAL_PRODUCTIVITY_PROXY', severity: 'warning', message: 'A complete company operating-capital history is unavailable. Industry sales-to-capital is a provisional investment-productivity proxy.' });
  if (v.amortization && v.amortization.value > Math.abs(v.ebit!.value) * .2) findings.push({ code: 'INTANGIBLE_AMORTIZATION', severity: 'warning', message: 'Intangible amortization is material relative to EBIT. GAAP EBIT remains the base. Any normalization needs a sourced amortization schedule and a consistent investment treatment.' });
  if (a.annualExtraInvestment > 0) findings.push({ code: 'INVESTMENT_DURATION', severity: 'warning', message: 'Excess current investment is held through all ten forecast years. A temporary capital cycle can make this assumption too severe. No spending reduction is assumed without evidence.' });
  if (v.investments && v.investments.value > revenue * .05) findings.push({ code: 'NONOPERATING_ASSETS', severity: 'warning', message: 'Material short-term investments are excluded pending review of operating needs, restrictions and taxes. Add verified excess assets in Analyst Mode.' });
  if (symbol === 'AMZN') findings.push({ code: 'MIXED_SEGMENTS', severity: 'warning', message: 'Retail (General) is a broad reference for Amazon. Cloud, retail and advertising need separate forecasts for a stronger estimate.' });
  if (daysBetween(current.end, retrievedAt.slice(0, 10)) > 45) findings.push({ code: 'VALUATION_TIMING', severity: 'warning', message: 'The latest reported annual or TTM figures supply the starting run rate. Unreported stub-period results are not inferred. Review the statement date against the valuation date.' });
  if (margin <= 0) findings.push({ code: 'TURNAROUND', severity: 'warning', message: 'The base case assumes a positive future margin. No NOL tax benefit is credited. The recovery needs evidence.' });
  findings.push({ code: 'RESEARCH_START', severity: 'warning', message: 'Automatic assumptions are disclosed model rules. They are not consensus forecasts. Management guidance, investment duration and accounting adjustments require analyst review.' });
  const ref = (index: number) => refs.references[index]?.url ?? 'Model policy';
  const notes: AssumptionNote[] = [
    { field: 'growth1', explanation: `Equal weight to the comparable annual-growth median (${(historicGrowth * 100).toFixed(1)}%) and ${trend.basis} (${(trend.value * 100).toFixed(1)}%). Bounded to −20% to 40%. This is a model policy, not consensus.`, source: trend.source },
    { field: 'growth2', explanation: '80% of year 1 growth + 20% of 2.5% stable growth.', source: 'Model policy' },
    { field: 'growth3', explanation: '60% of year 1 growth + 40% of 2.5% stable growth. Years 4–10 fade to stable growth.', source: 'Model policy' },
    { field: 'targetMargin', explanation: `75% of the latest reported operating margin + 25% of the ${industry.name} margin, bounded to 2%–50%. This does not establish sustainable profitability.`, source: ref(3) },
    { field: 'salesCapital', explanation: salesCapital === companyCapital ? 'Median recent revenue / (net PPE + complete noncash operating working capital). Historical capital efficiency is a proxy for marginal productivity.' : 'Industry sales / invested capital. Company-specific marginal investment productivity is not established.', source: salesCapital === companyCapital ? v.ppe?.url ?? v.revenue!.url : ref(5) },
    { field: 'terminalSalesCapital', explanation: 'Terminal ROIC / [target margin × (1 − tax)]. Transition years fade toward this capital productivity.', source: 'Damodaran FCFF framework' },
    { field: 'taxRate', explanation: 'US marginal tax rate from the dated country dataset. No immediate tax benefit is given to loss years.', source: ref(1) },
    { field: 'riskFree', explanation: 'Latest accepted 10-year US Treasury par yield, used as a USD risk-free proxy. The ERP uses the Treasury convention; no separate sovereign spread adjustment is mixed into the pair.', source: ref(0) },
    { field: 'erp', explanation: 'Latest accepted monthly implied ERP, trailing twelve-month adjusted payout variant, on the published US Treasury convention.', source: refs.references.find(r => r.name.includes('monthly implied'))?.url ?? ref(1) },
    { field: 'unleveredBeta', explanation: `Industry bottom-up beta for ${industry.name}, re-levered at the stable target debt/equity ratio.`, source: ref(2) },
    { field: 'debtWeight', explanation: a.debtWeight === 0 ? 'No target debt is imposed on a business with a verified zero debt basis.' : 'Industry D/E / (1 + D/E). The entered share price does not change this target capital mix.', source: ref(2) },
    { field: 'debtSpread', explanation: credit ? `Synthetic ${credit.rating} spread from EBIT / ${interest?.metric === 'interestPaid' ? 'cash interest' : 'interest expense'} = ${coverageRatio!.toFixed(1)}. Reported public float supports the large nonfinancial-firm table. This estimates credit risk; it is not an observed bond yield.` : a.debtWeight === 0 ? 'Unused for the zero-debt target capital structure.' : 'Dated industry pretax borrowing cost less the current Treasury proxy, floored at zero. Company credit research is still required.', source: refs.references.find(r => r.name.includes(credit ? 'synthetic credit' : 'borrowing cost'))?.url ?? ref(2) },
    { field: 'waccOverride', explanation: 'Blank uses calculated WACC. A manual value is an analyst assumption.', source: 'Analyst input' },
    { field: 'terminalGrowth', explanation: '2.5% nominal USD long-run growth policy. Must remain below WACC and terminal ROIC.', source: 'Model policy' },
    { field: 'terminalRoic', explanation: 'Industry ROIC bounded between WACC and WACC + 2 percentage points. Excess returns need support.', source: ref(4) },
    { field: 'ebitAdjustment', explanation: 'No automatic unusual-item or acquisition-amortization add-back. Enter a sourced annual EBIT adjustment and explain its duration.', source: 'Analyst input; default 0' },
    { field: 'annualExtraInvestment', explanation: 'Positive excess of current cash CapEx less D&A over initial modeled growth investment. Held through ten years until an analyst supports another capital plan.', source: v.capex!.url },
    { field: 'otherAssets', explanation: 'No extra assets are included without review. Cash equivalents are already included once.', source: 'Explicit provisional exclusion; default 0' },
    { field: 'otherClaims', explanation: 'Add verified omitted claims after checking for overlap with recorded debt and leases.', source: 'Explicit provisional exclusion; default 0' },
    { field: 'dilution', explanation: 'No future issuance or buybacks assumed. SBC stays in EBIT. An optional dilution rate adjusts year 10 shares.', source: 'Model policy; default 0' },
    { field: 'wcRatio', explanation: current.workingCapital === null ? 'Unavailable. Working-capital investment and implied CapEx remain blank. An analyst can enter a supported allocation.' : 'Noncash operating working capital / revenue. Cash, short-term investments and financing liabilities are excluded. Bounded to −20% to 30%.', source: v.assetsCurrent?.url ?? 'Accounting review required' },
    { field: 'daRatio', explanation: v.da ? 'Reported complete D&A / revenue, bounded to 0–30%. Separate components are retained in source evidence.' : 'Unavailable. D&A and implied CapEx remain blank until a supported assumption is entered.', source: v.da?.url ?? 'Accounting review required' },
  ];
  result.assumptions = a;
  result.assumptionNotes = notes;
  result.input = { revenue, margin, bridge, periodEnd: current.end, valuationDate: retrievedAt.slice(0, 10) };
  result.serverScenarios = scenarios(result.input, a);
  return result;
}
