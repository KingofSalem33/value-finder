export type Metric = 'revenue' | 'ebit' | 'netIncome' | 'tax' | 'pretax' | 'da' | 'depreciation' | 'amortization' | 'ocf' | 'capex' | 'cash' | 'equity' | 'shares' | 'currentShares' | 'sbc' | 'acquisitions' | 'assetsCurrent' | 'liabilitiesCurrent' | 'ppe' | 'debt' | 'debtCurrent' | 'debtNoncurrent' | 'shortDebt' | 'leaseCurrent' | 'leaseNoncurrent' | 'financeLeaseCurrent' | 'financeLeaseNoncurrent' | 'interest' | 'interestPaid' | 'minority' | 'preferred' | 'investments';
export interface RawFact { start?: string; end: string; val: number; accn: string; fy?: number; fp?: string; form: string; filed: string; frame?: string; url?: string; retrievedAt?: string; context?: string; decimals?: number | string | null; dimensions?: Record<string, string>; note?: string }
interface FilingFact extends RawFact { tag: string; unit: string }
export interface CompanyFacts { cik: number; entityName: string; facts: Record<string, Record<string, { label?: string; units: Record<string, RawFact[]> }>>; filingFacts?: FilingFact[] }
export interface Submissions { cik: string; name: string; sic: string; sicDescription: string; tickers: string[]; exchanges: string[]; fiscalYearEnd: string; entityType?: string; filings?: { recent: { accessionNumber: string[]; primaryDocument: string[]; form: string[]; filingDate: string[]; reportDate?: string[] } } }
export interface Evidence { value: number; metric: Metric; tag: string; unit: string; currency: string | null; start: string | null; end: string; filed: string; accession: string; form: string; retrievedAt: string; url: string; context?: string; decimals?: number | string | null; derivedFrom?: Evidence[]; note?: string }
export interface Period { label: string; start: string; end: string; days: number; kind: 'annual' | 'ttm'; values: Partial<Record<Metric, Evidence>>; reportedFcf: number | null; workingCapital: number | null }
type Severity = 'info' | 'warning' | 'error';
export interface Finding { code: string; severity: Severity; message: string }
export interface Reference { name: string; url: string; asOf: string; retrievedAt: string; values: Record<string, number | string> }
interface Industry { name: string; unleveredBeta: number; debtEquity: number; margin: number; roic: number; salesCapital: number; costDebt?: number }
export interface ReferenceSet { industry: Industry | null; references: Reference[]; riskFree: number; erp: number; marginalTax: number; creditSpreads?: { lower: number; rating: string; spread: number }[] }
export interface Assumptions {
  growth1: number; growth2: number; growth3: number; targetMargin: number;
  salesCapital: number; terminalSalesCapital: number; taxRate: number;
  riskFree: number; erp: number; unleveredBeta: number; debtWeight: number; debtSpread: number;
  waccOverride: number | null; terminalGrowth: number; terminalRoic: number;
  ebitAdjustment: number; annualExtraInvestment: number; otherAssets: number; otherClaims: number;
  dilution: number; wcRatio: number | null; daRatio: number | null;
}
export interface AssumptionNote { field: keyof Assumptions; explanation: string; source: string }
export interface Bridge { cash: number; debt: number; shares: number; leaseDebt: number; minority: number; preferred: number; otherAssets: number; otherClaims: number }
export interface ModelInput { revenue: number; margin: number; bridge: Bridge; periodEnd: string; valuationDate: string }
interface ForecastYear { year: number; growth: number; revenue: number; margin: number; ebit: number; tax: number; nopat: number; da: number | null; capex: number | null; workingCapital: number | null; reinvestment: number; fcff: number; pv: number; salesCapital: number; incrementalRoic: number }
export interface DcfResult { years: ForecastYear[]; wacc: number; terminalNopat: number; terminalReinvestment: number; terminalFcff: number; terminalValue: number; pvTerminal: number; terminalShare: number; enterpriseValue: number; equityValue: number; perShare: number; bridge: Bridge; findings: Finding[] }
export interface Research { version: string; symbol: string; company: Submissions; retrievedAt: string; origin: 'SEC collection' | 'User import'; inputDigest: string; periods: Period[]; current: Period | null; findings: Finding[]; references: Reference[]; industry: Industry | null; assumptions: Assumptions | null; assumptionNotes: AssumptionNote[]; input: ModelInput | null; specialized: boolean; serverScenarios: ReturnType<typeof import('./valuation').scenarios> | null }
