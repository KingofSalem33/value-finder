import coverage from '../data/coverage.json';
import industryMap from '../data/industry-map.json';

export class SourceError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export function industryName(symbol: string, sic: number, cik?: number): string | null {
  const profile = (coverage as Record<string, { cik: number; industry: string }>)[symbol];
  const reviewed = profile && (cik === undefined || profile.cik === cik) ? profile : null;
  if (reviewed) return reviewed.industry;
  return industryMap.find(row => sic >= row.from && sic <= row.to)?.industry ?? null;
}
