import type { CompanyFacts, Evidence, Finding, Metric, Period, RawFact } from './types';

// Ordered alternatives, never sums: tags can overlap economically.
export const TAGS: Record<Metric, string[]> = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  ebit: ['OperatingIncomeLoss'], netIncome: ['NetIncomeLoss', 'ProfitLoss'],
  tax: ['IncomeTaxExpenseBenefit'], pretax: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationDepletionAndAmortizationPropertyPlantAndEquipment', 'DepreciationAmortizationAndAccretionNet'],
  depreciation: ['OtherDepreciationAndAmortization', 'Depreciation'], amortization: ['AmortizationOfIntangibleAssets'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities'], capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'], equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  shares: ['WeightedAverageNumberOfDilutedSharesOutstanding'], currentShares: ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'],
  sbc: ['ShareBasedCompensation'], acquisitions: ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'PaymentsToAcquireBusinessesGross'],
  assetsCurrent: ['AssetsCurrent'], liabilitiesCurrent: ['LiabilitiesCurrent'], ppe: ['PropertyPlantAndEquipmentNet'],
  debt: ['LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities', 'LongTermDebtCurrentAndNoncurrent', 'DebtLongtermAndShorttermCombinedAmount', 'review:DebtFree'],
  debtCurrent: ['DebtCurrent', 'LongTermDebtAndFinanceLeaseObligationsCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'LongTermDebtCurrent'],
  debtNoncurrent: ['LongTermDebtAndFinanceLeaseObligationsNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermDebtNoncurrent', 'LongTermDebt'],
  shortDebt: ['ShortTermBorrowings', 'ShortTermDebtCurrent', 'CommercialPaper'],
  leaseCurrent: ['OperatingLeaseLiabilityCurrent'], leaseNoncurrent: ['OperatingLeaseLiabilityNoncurrent'],
  financeLeaseCurrent: ['FinanceLeaseLiabilityCurrent', 'CapitalLeaseObligationsCurrent'], financeLeaseNoncurrent: ['FinanceLeaseLiabilityNoncurrent', 'CapitalLeaseObligationsNoncurrent'],
  interest: ['InterestExpenseNonOperating', 'InterestAndDebtExpense', 'InterestExpense'],
  interestPaid: ['InterestPaidNet', 'InterestPaid'],
  minority: ['MinorityInterest'], preferred: ['PreferredStockValue', 'PreferredStockCarryingValue'],
  investments: ['ShortTermInvestments', 'MarketableSecuritiesCurrent'],
};
const INSTANT = new Set<Metric>(['cash', 'equity', 'currentShares', 'assetsCurrent', 'liabilitiesCurrent', 'ppe', 'debt', 'debtCurrent', 'debtNoncurrent', 'shortDebt', 'leaseCurrent', 'leaseNoncurrent', 'financeLeaseCurrent', 'financeLeaseNoncurrent', 'minority', 'preferred', 'investments']);
export const daysBetween = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
const allowed = (f: RawFact) => (['10-K', '10-K/A', '10-Q', '10-Q/A'].includes(f.form) || (f.form === '8-K' && 'tag' in f && f.tag === 'review:DebtFree' && f.val === 0 && !f.start)) && Number.isFinite(f.val) && /^\d{4}-\d{2}-\d{2}$/.test(f.end) && /^\d{4}-\d{2}-\d{2}$/.test(f.filed) && !Number.isNaN(Date.parse(f.end));
function filingUrl(cik: number, accession: string) { return `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll('-', '')}/${accession}-index.html`; }

export function getFact(data: CompanyFacts, metric: Metric, start: string, end: string, retrievedAt: string, asOf = retrievedAt.slice(0, 10), tags = TAGS[metric]): Evidence | undefined {
  const candidates: { fact: RawFact; tag: string; unit: string; priority: number }[] = [];
  tags.forEach((name, priority) => {
    const [prefix, local] = name.includes(':') ? name.split(':') : ['us-gaap', name];
    for (const namespace of name.includes(':') ? [prefix] : ['us-gaap', 'dei']) {
      const tag = local;
      const concept = data.facts[namespace]?.[tag];
      if (!concept) continue;
      for (const [unit, facts] of Object.entries(concept.units)) {
        if (metric === 'shares' || metric === 'currentShares' ? unit !== 'shares' : !/^[A-Z]{3}$/.test(unit)) continue;
        for (const fact of facts) {
          if (!allowed(fact) || fact.filed > asOf || fact.end !== end) continue;
          if (INSTANT.has(metric) ? !!fact.start : fact.start !== start) continue;
          candidates.push({ fact, tag, unit, priority });
        }
      }
    }
  });
  for (const f of data.filingFacts ?? []) {
    const tagPriority = tags.findIndex(tag => tag.includes(':') ? tag === f.tag : f.tag === `us-gaap:${tag}` || f.tag === `dei:${tag}`);
    const priority = tagPriority >= 0 ? tagPriority : f.statementMetric === metric ? tags.length : -1;
    if (priority < 0 || !allowed(f) || f.filed > asOf || f.end !== end || Object.keys(f.dimensions ?? {}).length) continue;
    if (metric === 'shares' || metric === 'currentShares' ? f.unit !== 'shares' : !/^[A-Z]{3}$/.test(f.unit)) continue;
    if (INSTANT.has(metric) ? !!f.start : f.start !== start) continue;
    candidates.push({ fact: f, tag: f.tag, unit: f.unit, priority });
  }
  // The newest comparative disclosure wins, including amendments. Tag priority breaks ties.
  candidates.sort((a, b) => b.fact.filed.localeCompare(a.fact.filed) || a.priority - b.priority || b.fact.accn.localeCompare(a.fact.accn) || Number(!!b.fact.context) - Number(!!a.fact.context));
  const selected = candidates[0];
  if (!selected) return undefined;
  const { fact: f, tag, unit } = selected;
  if (f.url && !/^https:\/\//i.test(f.url)) throw new Error('Financial evidence requires an HTTPS source URL.');
  // Never pick an arbitrary conflicting consolidated duplicate from one filing.
  const peers = candidates.filter(c => c.fact.accn === f.accn && c.fact.filed === f.filed && c.priority === selected.priority && c.unit === unit);
  const tolerance = (fact: RawFact) => typeof fact.decimals === 'number' ? .5 * 10 ** -fact.decimals : 0;
  if (peers.some(c => Math.abs(c.fact.val - f.val) > Math.max(1e-8, tolerance(c.fact) + tolerance(f)))) return undefined;
  return { value: f.val, metric, tag, unit, currency: unit === 'shares' ? null : unit, start: f.start ?? null, end: f.end, filed: f.filed, accession: f.accn, form: f.form, retrievedAt: f.retrievedAt ?? retrievedAt, url: f.url ?? filingUrl(data.cik, f.accn), ...(f.context ? { context: f.context, decimals: f.decimals } : {}), ...(f.note ? { note: f.note } : {}), ...('statementMetric' in f ? { statementMetric: f.statementMetric as Metric } : {}) };
}

function derived(metric: Metric, sources: Evidence[], value: number, note: string): Evidence {
  const newest = [...sources].sort((a, b) => b.filed.localeCompare(a.filed))[0];
  return { ...newest, metric, value, tag: 'derived', derivedFrom: sources, note };
}

export const includesShortDebt = (e: Evidence): boolean => e.statementMetric === 'debtCurrent' || /(?:^|:)DebtCurrent$|DebtLongtermAndShorttermCombinedAmount/.test(e.tag) || !!e.derivedFrom?.some(includesShortDebt);
export function includesFinanceLeases(e: Evidence, term: 'current' | 'noncurrent' | 'both' = 'both'): boolean {
  if (term === 'both') return includesFinanceLeases(e, 'current') && includesFinanceLeases(e, 'noncurrent');
  if (e.derivedFrom) return e.derivedFrom.some(component => includesFinanceLeases(component, term));
  if (/IncludingCurrentMaturities/.test(e.tag) && /FinanceLease|CapitalLease/.test(e.tag)) return true;
  if (term === 'current') return /(?:^|:)DebtCurrent$|(?:FinanceLease|CapitalLease)ObligationsCurrent$/.test(e.tag);
  return /(?:FinanceLease|CapitalLease)ObligationsNoncurrent$|(?:^|:)LongTermDebtAndCapitalLeaseObligations$/.test(e.tag);
}
function completePeriod(period: Period) {
  const v = period.values;
  if (!v.debt && v.debtCurrent && v.debtNoncurrent && v.debtCurrent.unit === v.debtNoncurrent.unit) {
    v.debt = derived('debt', [v.debtCurrent, v.debtNoncurrent], v.debtCurrent.value + v.debtNoncurrent.value, 'Current + noncurrent borrowings. A broad DebtCurrent fact already includes current short-term debt.');
  }
  period.reportedFcf = v.ocf && v.capex && v.ocf.unit === v.capex.unit ? v.ocf.value - v.capex.value : null;
  // Noncash operating working capital excludes cash and financing current liabilities.
  const shortCovered = v.debtCurrent && includesShortDebt(v.debtCurrent);
  const financeCovered = v.debtCurrent && includesFinanceLeases(v.debtCurrent, 'current');
  period.workingCapital = v.assetsCurrent && v.liabilitiesCurrent && v.cash && v.investments && v.debtCurrent && (shortCovered || v.shortDebt) && v.leaseCurrent && (financeCovered || v.financeLeaseCurrent)
    ? v.assetsCurrent.value - v.cash.value - v.investments.value - v.liabilitiesCurrent.value + v.debtCurrent.value + (shortCovered ? 0 : v.shortDebt!.value) + v.leaseCurrent.value + (financeCovered ? 0 : v.financeLeaseCurrent!.value) : null;
  return period;
}

function makePeriod(data: CompanyFacts, start: string, end: string, retrievedAt: string): Period {
  const values: Period['values'] = {};
  for (const metric of Object.keys(TAGS) as Metric[]) {
    const fact = periodFact(data, metric, start, end, retrievedAt);
    if (fact) values[metric] = fact;
  }
  return completePeriod({ start, end, days: daysBetween(start, end), label: `FY ended ${end}`, kind: 'annual', values, reportedFcf: null, workingCapital: null });
}

function periodFact(data: CompanyFacts, metric: Metric, start: string, end: string, retrievedAt: string) {
  // AMD reports other D&A and acquisition-intangible amortization separately in
  // its cash-flow statement. Depreciation alone is an incomplete D&A measure.
  if (metric === 'da') {
    const total = getFact(data, metric, start, end, retrievedAt);
    const depreciation = getFact(data, 'depreciation', start, end, retrievedAt, undefined, data.cik === 2488 ? ['OtherDepreciationAndAmortization'] : ['Depreciation']);
    const amortization = getFact(data, 'amortization', start, end, retrievedAt);
    if (depreciation && amortization && depreciation.accession === amortization.accession && depreciation.unit === amortization.unit) {
      const combined = derived('da', [depreciation, amortization], depreciation.value + amortization.value, 'Separate reported depreciation/D&A and intangible amortization components from the same filing and fiscal period. No aggregate D&A is added again.');
      return total && total.filed >= combined.filed ? total : combined;
    }
    return total;
  }
  return getFact(data, metric, start, end, retrievedAt);
}

export function ttmValue(annual: number, currentYtd: number, priorYtd: number) { return annual + currentYtd - priorYtd; }
export function standaloneQuarter(currentYtd: number | null, previousYtd: number | null): number | null { return currentYtd === null || previousYtd === null ? null : currentYtd - previousYtd; }

export function normalize(data: CompanyFacts, retrievedAt: string): { periods: Period[]; current: Period | null; findings: Finding[] } {
  if (!data || !Number.isInteger(Number(data.cik)) || !data.facts || typeof data.facts !== 'object') throw new Error('Invalid SEC companyfacts file.');
  const findings: Finding[] = [];
  const revenueFacts = [...TAGS.revenue.flatMap(tag => Object.values(data.facts['us-gaap']?.[tag]?.units ?? {}).flat()), ...(data.filingFacts ?? []).filter(f => TAGS.revenue.some(tag => f.tag === `us-gaap:${tag}`) && !Object.keys(f.dimensions ?? {}).length)].filter(f => allowed(f) && f.filed <= retrievedAt.slice(0, 10));
  const annualEnds = new Map<string, string>();
  for (const f of revenueFacts.filter(f => f.start && /^10-K/.test(f.form) && daysBetween(f.start, f.end) >= 330 && daysBetween(f.start, f.end) <= 380).sort((a, b) => b.filed.localeCompare(a.filed) || b.accn.localeCompare(a.accn))) {
    if (!annualEnds.has(f.end)) annualEnds.set(f.end, f.start!);
  }
  const periods = [...annualEnds].sort(([a], [b]) => a.localeCompare(b)).slice(-10).map(([end, start]) => makePeriod(data, start, end, retrievedAt));
  let current = periods.at(-1) ?? null;
  if (!current) return { periods, current, findings: [{ code: 'NO_ANNUAL', severity: 'error', message: 'No usable annual revenue period. A 10-K US-GAAP model is required.' }] };
  const annual = current;
  const fiscalStart = new Date(Date.parse(annual.end) + 86400000).toISOString().slice(0, 10);
  const ytds = revenueFacts.filter(f => f.start === fiscalStart && f.end > annual.end && daysBetween(f.start, f.end) >= 60 && daysBetween(f.start, f.end) <= 300).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const ytd = ytds[0];
  if (ytd?.start) {
    const duration = daysBetween(ytd.start, ytd.end);
    const prior = revenueFacts.filter(f => f.start === annual.start && Math.abs(daysBetween(f.start, f.end) - duration) <= 8).sort((a, b) => b.filed.localeCompare(a.filed))[0];
    if (prior?.start) {
      const values: Period['values'] = {};
      for (const metric of Object.keys(TAGS) as Metric[]) {
        const now = periodFact(data, metric, ytd.start, ytd.end, retrievedAt);
        if (INSTANT.has(metric)) { if (now) values[metric] = now; continue; }
        const then = periodFact(data, metric, prior.start, prior.end, retrievedAt);
        const fy = annual.values[metric];
        if (!now || !then || !fy || now.unit !== then.unit || now.unit !== fy.unit) continue;
        const value = metric === 'shares'
          ? (fy.value * annual.days + now.value * duration - then.value * daysBetween(prior.start, prior.end)) / (annual.days + duration - daysBetween(prior.start, prior.end))
          : ttmValue(fy.value, now.value, then.value);
        values[metric] = derived(metric, [fy, now, then], value, metric === 'shares' ? 'Day-weighted diluted shares: annual + current YTD - prior YTD share-days, divided by TTM days.' : 'TTM = latest annual + current fiscal YTD - prior comparable fiscal YTD.');
      }
      const ttmStart = new Date(Date.parse(prior.end) + 86400000).toISOString().slice(0, 10);
      for (const evidence of Object.values(values)) if (evidence.derivedFrom) evidence.start = ttmStart;
      current = completePeriod({ label: `TTM ended ${ytd.end}`, start: ttmStart, end: ytd.end, days: daysBetween(ttmStart, ytd.end), kind: 'ttm', values, reportedFcf: null, workingCapital: null });
      if (current.days < 350 || current.days > 380) findings.push({ code: 'TTM_LENGTH', severity: 'error', message: 'The TTM window is not comparable to a full fiscal year.' });
    } else findings.push({ code: 'NO_TTM', severity: 'warning', message: 'A quarterly report exists, but a comparable prior YTD period is missing. The annual model is used.' });
  } else if (revenueFacts.some(f => /^10-Q/.test(f.form) && f.end > annual.end)) findings.push({ code: 'NO_TTM', severity: 'warning', message: 'A quarterly report exists, but fiscal YTD revenue is missing. Standalone quarters are not treated as YTD. The annual model is used.' });
  const v = current.values;
  const required = { revenue: 'revenue', ebit: 'operating income', ocf: 'operating cash flow', capex: 'capital expenditure', cash: 'cash and cash equivalents', debt: 'total interest-bearing debt', shares: 'diluted shares' };
  for (const key of Object.keys(required) as (keyof typeof required)[]) {
    if (!v[key]) findings.push({ code: `MISSING_${key}`, severity: 'error', message: `Could not verify ${required[key]} for the period ended ${current.end}.` });
  }
  if (v.cash?.statementMetric === 'cash' && /RestrictedCash/.test(v.cash.tag)) findings.push({ code: 'CASH_SCOPE', severity: 'warning', message: 'The balance sheet labels the selected amount cash and cash equivalents, but its XBRL tag also refers to restricted cash. Verify the amount available to shareholders.' });
  const currencies = new Set(Object.values(v).filter(x => x.unit !== 'shares').map(x => x.currency));
  if (currencies.size !== 1 || !currencies.has('USD')) findings.push({ code: 'CURRENCY', severity: 'error', message: 'Only consistent USD financial statements and USD listed shares are supported. Currency conversion requires review.' });
  if (v.revenue && v.revenue.value <= 0) findings.push({ code: 'REVENUE', severity: 'error', message: 'Revenue must be positive.' });
  if (v.shares && v.shares.value <= 0) findings.push({ code: 'SHARES', severity: 'error', message: 'Diluted shares must be positive.' });
  for (const metric of ['capex', 'cash', 'debt', 'shortDebt', 'financeLeaseCurrent', 'financeLeaseNoncurrent'] as Metric[]) {
    if (v[metric] && v[metric]!.value < 0) findings.push({ code: `SIGN_${metric}`, severity: 'error', message: `${metric} has an unexpected negative sign. Review the original filing.` });
  }
  if (v.capex && v.da && v.capex.value > Math.max(v.da.value * 1.8, (v.revenue?.value ?? Infinity) * .08)) findings.push({ code: 'CAPITAL_CYCLE', severity: 'warning', message: 'Capital spending is high relative to depreciation and revenue. Review investment plans. Lower reported FCF alone is not evidence of business decline; returns on new investment remain uncertain.' });
  if (v.acquisitions && v.revenue && v.acquisitions.value > v.revenue.value * .05) findings.push({ code: 'ACQUISITIONS', severity: 'warning', message: 'Acquisitions exceed 5% of revenue. Historical growth may include purchased growth.' });
  const previous = periods.filter(p => p.end < current!.end).at(-1);
  if (previous?.values.shares && v.shares) {
    const ratio = v.shares.value / previous.values.shares.value;
    if (ratio < .7 || ratio > 1.3) findings.push({ code: 'SHARE_CHANGE', severity: 'error', message: 'The diluted share basis changed by more than 30%. Review splits, issuance and restated comparatives before valuing a listed share.' });
  }
  if (daysBetween(current.end, retrievedAt.slice(0, 10)) > 200) findings.push({ code: 'STALE_FINANCIALS', severity: 'warning', message: 'The latest usable financial period ended more than 200 days ago.' });
  findings.push({ code: 'EXTRACTION_REVIEW', severity: 'warning', message: 'Automated extraction does not establish complete accounting coverage. Custom tags, segment financing, tax losses, lease treatment, unusual items and nonoperating assets require filing review.' });
  return { periods, current, findings };
}
