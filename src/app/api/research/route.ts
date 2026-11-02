import { NextRequest, NextResponse } from 'next/server';
import { buildResearch } from '@/lib/research';
import { SourceError } from '@/lib/sources';
export const runtime = 'nodejs';
export const maxDuration = 10;
const symbolFrom = (s: string | null) => { const symbol = (s ?? '').trim().toUpperCase(); if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new SourceError('Enter a valid US stock symbol.', 400); return symbol; };
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Research could not be loaded.', importAvailable: true }, { status: error instanceof SourceError ? error.status : 422 }); }
export async function GET(request: NextRequest) {
  try { return NextResponse.json(await buildResearch(symbolFrom(request.nextUrl.searchParams.get('symbol'))), { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=60' } }); } catch (e) { return failure(e); }
}
export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    if (text.length > 4_000_000) throw new SourceError('Import exceeds 4 MB. Keep only standard US-GAAP and DEI facts before import.', 413);
    const data = JSON.parse(text);
    const result = await buildResearch(symbolFrom(data.symbol), { facts: data.facts, submissions: data.submissions });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(e); }
}
