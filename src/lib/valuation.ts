import type { Assumptions, Bridge, DcfResult, Finding, ModelInput } from './types';

export const MODEL_VERSION = 'fcff-2.1.0';
export function marginOfSafety(intrinsicValue: number, price: number): number | null {
  return Number.isFinite(intrinsicValue) && intrinsicValue > 0 && Number.isFinite(price) && price > 0 ? 1 - price / intrinsicValue : null;
}
export function discountRate(a: Assumptions) {
  if (![a.riskFree, a.erp, a.unleveredBeta, a.debtWeight, a.debtSpread, a.taxRate].every(Number.isFinite) || a.debtWeight < 0 || a.debtWeight >= .95 || a.taxRate < 0 || a.taxRate > .6 || a.erp < 0 || a.unleveredBeta <= 0 || a.debtSpread < 0) throw new Error('Invalid WACC inputs.');
  const equityWeight = 1 - a.debtWeight;
  const leveredBeta = a.unleveredBeta * (1 + (1 - a.taxRate) * a.debtWeight / equityWeight);
  const costEquity = a.riskFree + leveredBeta * a.erp;
  const costDebt = a.riskFree + a.debtSpread;
  const calculated = costEquity * equityWeight + costDebt * (1 - a.taxRate) * a.debtWeight;
  return { equityWeight, debtWeight: a.debtWeight, leveredBeta, costEquity, costDebt, afterTaxDebt: costDebt * (1 - a.taxRate), calculated, wacc: a.waccOverride ?? calculated };
}
export function terminalValue(nopat: number, growth: number, roic: number, wacc: number) {
  if (![nopat, growth, roic, wacc].every(Number.isFinite) || wacc <= growth || growth < 0 || roic <= growth || nopat <= 0) throw new Error('Terminal period requires positive NOPAT, 0 ≤ growth < WACC and growth < ROIC.');
  const reinvestment = nopat * growth / roic;
  const fcff = nopat - reinvestment;
  return { reinvestment, fcff, value: fcff / (wacc - growth) };
}
export function equityBridge(enterpriseValue: number, b: Bridge) { return enterpriseValue + b.cash + b.otherAssets - b.debt - b.leaseDebt - b.minority - b.preferred - b.otherClaims; }
export function listedShareValue(equity: number, ordinaryShares: number, ordinaryPerListedShare: number, listedCurrencyPerFinancialCurrency: number) {
  if (![equity, ordinaryShares, ordinaryPerListedShare, listedCurrencyPerFinancialCurrency].every(Number.isFinite) || ordinaryShares <= 0 || ordinaryPerListedShare <= 0 || listedCurrencyPerFinancialCurrency <= 0) throw new Error('Invalid share or currency conversion.');
  return equity / ordinaryShares * ordinaryPerListedShare * listedCurrencyPerFinancialCurrency;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function calculate(input: ModelInput, a: Assumptions): DcfResult {
  for (const [key, value] of Object.entries(a)) if (!(value === null && ['waccOverride', 'wcRatio', 'daRatio'].includes(key)) && !Number.isFinite(value)) throw new Error(`Invalid assumption: ${key}.`);
  if (a.waccOverride !== null && !Number.isFinite(a.waccOverride)) throw new Error('Invalid WACC override.');
  if (!Number.isFinite(input.revenue) || !Number.isFinite(input.margin) || input.revenue <= 0 || Object.values(input.bridge).some(v => !Number.isFinite(v)) || input.bridge.shares <= 0) throw new Error('Invalid financial inputs.');
  if ([a.growth1, a.growth2, a.growth3].some(g => g <= -.8 || g > .6) || a.targetMargin <= 0 || a.targetMargin > .7 || a.salesCapital < .1 || a.terminalSalesCapital < .1 || a.dilution < 0 || a.dilution > .2 || (a.daRatio !== null && (a.daRatio < 0 || a.daRatio > .5)) || (a.wcRatio !== null && (a.wcRatio < -.5 || a.wcRatio > .8)) || a.annualExtraInvestment < 0) throw new Error('Forecast assumptions exceed supported economic bounds.');
  const { wacc } = discountRate(a);
  if (wacc <= .01 || wacc > .4 || a.terminalGrowth > .05) throw new Error('WACC or stable growth exceeds model limits.');
  const findings: Finding[] = [];
  let revenue = input.revenue;
  const startMargin = input.margin + a.ebitAdjustment / revenue;
  const years = [];
  for (let year = 1; year <= 10; year++) {
    const growth = year === 1 ? a.growth1 : year === 2 ? a.growth2 : year === 3 ? a.growth3 : lerp(a.growth3, a.terminalGrowth, (year - 3) / 7);
    const lastRevenue = revenue;
    revenue *= 1 + growth;
    const margin = lerp(startMargin, a.targetMargin, year / 10);
    const ebit = revenue * margin;
    // Loss years receive no immediate cash tax benefit. NOL schedules are not inferred.
    const tax = Math.max(0, ebit) * a.taxRate;
    const nopat = ebit - tax;
    const salesCapital = year <= 3 ? a.salesCapital : lerp(a.salesCapital, a.terminalSalesCapital, (year - 3) / 7);
    // ΔRevenue / sales-to-capital is TOTAL reinvestment, inclusive of working capital.
    // No capital-release credit is assumed during contraction.
    const reinvestment = Math.max(0, revenue - lastRevenue) / salesCapital + a.annualExtraInvestment;
    const workingCapital = a.wcRatio === null ? null : (revenue - lastRevenue) * a.wcRatio;
    const da = a.daRatio === null ? null : revenue * a.daRatio;
    const capex = da === null || workingCapital === null ? null : da + reinvestment - workingCapital;
    if (capex !== null && capex < 0) throw new Error('The implied capital expenditure is negative. Revise working capital or sales-to-capital assumptions.');
    const fcff = nopat - reinvestment;
    years.push({ year, growth, revenue, margin, ebit, tax, nopat, da, capex, workingCapital, reinvestment, fcff, pv: fcff / (1 + wacc) ** year, salesCapital, incrementalRoic: margin * (1 - a.taxRate) * salesCapital });
  }
  const terminalNopat = revenue * (1 + a.terminalGrowth) * a.targetMargin * (1 - a.taxRate);
  const tv = terminalValue(terminalNopat, a.terminalGrowth, a.terminalRoic, wacc);
  const pvTerminal = tv.value / (1 + wacc) ** 10;
  const enterpriseValue = years.reduce((sum, y) => sum + y.pv, 0) + pvTerminal;
  const bridge = { ...input.bridge, otherAssets: a.otherAssets, otherClaims: a.otherClaims, shares: input.bridge.shares * (1 + a.dilution) ** 10 };
  const equityValue = equityBridge(enterpriseValue, bridge);
  const perShare = listedShareValue(equityValue, bridge.shares, 1, 1);
  const terminalShare = enterpriseValue > 0 ? pvTerminal / enterpriseValue : Infinity;
  if (terminalShare > .75) findings.push({ code: 'TERMINAL_WEIGHT', severity: 'warning', message: 'More than 75% of enterprise value comes from the terminal period.' });
  if (a.terminalRoic > wacc + .03) findings.push({ code: 'TERMINAL_EXCESS_RETURNS', severity: 'warning', message: 'Terminal ROIC exceeds WACC by more than 3 percentage points. A durable competitive advantage is required.' });
  if (Math.abs(years[9].incrementalRoic - a.terminalRoic) > .05) findings.push({ code: 'ROIC_TRANSITION', severity: 'warning', message: 'Year 10 incremental ROIC differs from terminal ROIC by more than 5 percentage points. Review the reinvestment transition.' });
  if (Math.abs(years[9].reinvestment / Math.max(1, years[9].nopat) - a.terminalGrowth / a.terminalRoic) > .15) findings.push({ code: 'REINVESTMENT_TRANSITION', severity: 'warning', message: 'Reinvestment changes materially at the terminal boundary. Review capital plans and terminal ROIC.' });
  if (equityValue <= 0) findings.push({ code: 'NONPOSITIVE_EQUITY', severity: 'error', message: 'Financing claims exceed modeled business value. A positive common-share value is not supported.' });
  if (![enterpriseValue, equityValue, perShare].every(Number.isFinite)) throw new Error('The model did not produce finite values.');
  return { years, wacc, terminalNopat, terminalReinvestment: tv.reinvestment, terminalFcff: tv.fcff, terminalValue: tv.value, pvTerminal, terminalShare, enterpriseValue, equityValue, perShare, bridge, findings };
}

export function scenarios(input: ModelInput, a: Assumptions) {
  let w: number;
  try { w = discountRate(a).wacc; }
  catch (e) { const failed = { assumptions: a, result: null, error: (e as Error).message }; return { bear: failed, base: failed, bull: failed }; }
  const bear: Assumptions = { ...a, growth1: Math.max(-.5, a.growth1 - .03), growth2: Math.max(-.5, a.growth2 - .03), growth3: Math.max(-.5, a.growth3 - .03), targetMargin: Math.max(.01, a.targetMargin - .025), salesCapital: a.salesCapital * .85, waccOverride: w + .01, terminalRoic: Math.max(a.terminalGrowth + .01, a.terminalRoic - .015) };
  const bull: Assumptions = { ...a, growth1: Math.min(.5, a.growth1 + .03), growth2: Math.min(.5, a.growth2 + .03), growth3: Math.min(.5, a.growth3 + .03), targetMargin: Math.min(.65, a.targetMargin + .025), salesCapital: a.salesCapital * 1.15, waccOverride: Math.max(a.terminalGrowth + .015, w - .01), terminalRoic: a.terminalRoic + .015 };
  bear.terminalSalesCapital = bear.terminalRoic / (bear.targetMargin * (1 - bear.taxRate));
  bull.terminalSalesCapital = bull.terminalRoic / (bull.targetMargin * (1 - bull.taxRate));
  const run = (assumptions: Assumptions) => { try { return { assumptions, result: calculate(input, assumptions), error: null }; } catch (e) { return { assumptions, result: null, error: (e as Error).message }; } };
  return { bear: run(bear), base: run(a), bull: run(bull) };
}
export function sensitivity(input: ModelInput, a: Assumptions) {
  const wacc = discountRate(a).wacc;
  return [-.01, -.005, 0, .005, .01].map(dw => ({ wacc: wacc + dw, values: [-.005, 0, .005].map(dg => {
    try { const r = calculate(input, { ...a, waccOverride: wacc + dw, terminalGrowth: a.terminalGrowth + dg }); return r.equityValue > 0 ? r.perShare : null; } catch { return null; }
  }) }));
}
export function reverseDcf(input: ModelInput, a: Assumptions, price: number, variable: 'growth' | 'margin' = 'growth') {
  if (!Number.isFinite(price) || price <= 0) return { value: null, reason: 'Enter a positive USD market price.' };
  const lower = variable === 'growth' ? -.2 : .01;
  const upper = variable === 'growth' ? .4 : .6;
  const evaluate = (x: number) => calculate(input, variable === 'growth' ? { ...a, growth1: x, growth2: x, growth3: x } : { ...a, targetMargin: x }).perShare - price;
  // Scan first: reinvestment can make growth/value nonmonotonic. Reject ambiguous roots.
  const brackets: [number, number][] = [];
  let last: { x: number; y: number } | null = null;
  for (let i = 0; i <= 120; i++) {
    const x = lower + (upper - lower) * i / 120;
    try {
      const y = evaluate(x);
      if (Math.abs(y) < 1e-8) return { value: x, reason: null };
      if (last && last.y * y < 0) brackets.push([last.x, x]);
      last = { x, y };
    } catch { last = null; }
  }
  if (brackets.length !== 1) return { value: null, reason: brackets.length > 1 ? 'Multiple solutions exist. The model cannot identify a unique market expectation.' : `No solution within ${variable === 'growth' ? '−20% to 40% annual growth' : '1% to 60% operating margin'}. Other assumptions may explain the price.` };
  let [lo, hi] = brackets[0];
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (evaluate(lo) * evaluate(mid) <= 0) hi = mid; else lo = mid; }
  return { value: (lo + hi) / 2, reason: null };
}
