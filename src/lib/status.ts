import type { DcfResult, Research } from './types';

export function researchStatus(research: Research, base: DcfResult | null, modelError?: string | null) {
  if (research.specialized) return 'SPECIALIZED VALUATION REQUIRED';
  if (modelError || base?.findings.some(f => f.severity === 'error')) return 'INVALID';
  if (!research.current) return 'DATA UNAVAILABLE';
  if (research.findings.some(f => f.severity === 'error')) return 'ACCOUNTING REVIEW';
  if (!base) return 'DATA UNAVAILABLE';
  return base.findings.some(f => f.severity === 'warning') ? 'MODEL SENSITIVE' : 'PROVISIONAL';
}

export function valuationBlocker(research: Research, base: DcfResult | null, modelError?: string | null): string {
  if (research.specialized) return research.findings.find(f => f.code === 'SPECIALIZED')?.message ?? 'This business requires a specialized valuation model.';
  if (modelError) return modelError;
  const messages = [...research.findings, ...(base?.findings ?? [])].filter(f => f.severity === 'error').map(f => f.message);
  return [...new Set(messages)].join(' ') || 'The financial inputs could not be verified. See Data checks.';
}
