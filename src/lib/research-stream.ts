import type { Research } from './types';

export type ResearchEvent = { type: 'progress'; message: string } | { type: 'result'; research: Research } | { type: 'error'; message: string };

export async function readResearchResponse(response: Response, progress: (message: string) => void): Promise<Research> {
  if (!response.ok) {
    const body = await response.json(); throw new Error(body.error ?? 'Research could not be loaded.');
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
  const reader = response.body?.getReader(); if (!reader) throw new Error('The research response has no body.');
  const decoder = new TextDecoder(); let buffer = ''; let result: Research | null = null;
  function consume(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ResearchEvent;
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'progress') progress(event.message);
    if (event.type === 'result') result = event.research;
  }
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 8_000_000) throw new Error('The research response exceeds the supported size.');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    buffer += decoder.decode(); consume(buffer);
    if (!result) throw new Error('The research request ended before a result was received. Try again.');
    return result;
  } finally { await reader.cancel().catch(() => {}); }
}
