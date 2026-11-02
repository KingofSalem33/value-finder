import coverage from '../data/coverage.json';

export class SourceError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export function industryName(symbol: string, sic: number): string | null {
  const reviewed = (coverage as Record<string, { industry: string }>)[symbol];
  if (reviewed) return reviewed.industry;
  // Source imports can use these explicit operating-industry mappings.
  if (sic >= 7370 && sic <= 7379) return 'Software (System & Application)';
  if (sic === 3674) return 'Semiconductor';
  if (sic >= 3570 && sic <= 3579) return 'Computers/Peripherals';
  if (sic >= 3500 && sic < 3570) return 'Machinery';
  if (sic >= 1600 && sic <= 1799) return 'Engineering/Construction';
  return null;
}
