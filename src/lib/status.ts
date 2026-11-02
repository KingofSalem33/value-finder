import type { DcfResult, Research } from './types';

export function researchStatus(research: Research, base: DcfResult | null, modelError?: string | null) {
  if (research.specialized) return 'SPECIALIZED VALUATION REQUIRED';
  if (modelError || base?.findings.some(f => f.severity === 'error')) return 'INVALID';
  if (!research.current) return 'DATA UNAVAILABLE';
  if (research.findings.some(f => f.severity === 'error')) return 'ACCOUNTING REVIEW';
  if (!base) return 'DATA UNAVAILABLE';
  return base.findings.some(f => f.severity === 'warning') ? 'MODEL SENSITIVE' : 'PROVISIONAL';
}
