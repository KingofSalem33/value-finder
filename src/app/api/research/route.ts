import { NextRequest, NextResponse } from 'next/server';
import { buildResearch } from '@/lib/research';
import { SourceError } from '@/lib/sources';
import type { ResearchEvent } from '@/lib/research-stream';
export const runtime = 'nodejs';
export const maxDuration = 60;
const symbolFrom = (s: string | null) => { const symbol = (s ?? '').trim().toUpperCase(); if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new SourceError('Enter a valid US stock symbol.', 400); return symbol; };
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Research could not be loaded.', importAvailable: true }, { status: error instanceof SourceError ? error.status : 422 }); }
export async function GET(request: NextRequest) {
  let symbol: string;
  try { symbol = symbolFrom(request.nextUrl.searchParams.get('symbol')); } catch (error) { return failure(error); }
  if (request.headers.get('accept')?.includes('application/x-ndjson')) {
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: ResearchEvent) => { if (!cancelled) controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')); };
        try { send({ type: 'result', research: await buildResearch(symbol, undefined, message => send({ type: 'progress', message })) }); }
        catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : 'Research could not be loaded.' }); }
        finally { if (!cancelled) { cancelled = true; controller.close(); } }
      },
      cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  try { return NextResponse.json(await buildResearch(symbol), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return failure(e); }
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
