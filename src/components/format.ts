export const money = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
export const pct = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(1)}%`;
export const amount = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n / 1e6);
