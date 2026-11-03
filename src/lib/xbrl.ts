import { XMLParser } from 'fast-xml-parser';
import { TAGS } from './normalize';
import type { CompanyFacts } from './types';

type Node = Record<string, unknown>;
const object = (value: unknown): Node => value && typeof value === 'object' && !Array.isArray(value) ? value as Node : {};
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const local = (key: string) => key.split(':').at(-1)!;
const child = (node: Node, name: string) => node[Object.keys(node).find(key => local(key) === name) ?? ''];
const text = (value: unknown): string => typeof value === 'string' ? value : String(object(value)['#text'] ?? '');
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : null;
export const usedTags = new Set([...Object.values(TAGS).flat().map(tag => tag.split(':').at(-1)!), 'EntityPublicFloat', 'NotesPayableCurrent', 'LongTermNotesAndLoans', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'PaymentsToAcquireOtherPropertyPlantAndEquipment']);

export interface Filing { cik: number; accession: string; filed: string; form: string; end: string; document: string }

/** Read standard monetary/share facts from an extracted XBRL instance, never inline HTML. */
export function parseInstance(xml: string, filing: Filing, url: string, retrievedAt: string): NonNullable<CompanyFacts['filingFacts']> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entity declarations are not supported in XBRL.');
  const parsed = object(new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: true, processEntities: false }).parse(xml));
  const root = object(child(parsed, 'xbrl'));
  if (!Object.keys(root).length) throw new Error('The filing is not an extracted XBRL instance.');
  const namespaces = new Map(Object.entries(root).filter(([key]) => key.startsWith('@_xmlns:')).map(([key, value]) => [key.slice(8), String(value)]));
  const contexts = new Map<string, { start?: string; end: string }>();
  for (const item of list(child(root, 'context'))) {
    const c = object(item); const entity = object(child(c, 'entity'));
    if (child(entity, 'segment') !== undefined || child(c, 'scenario') !== undefined) continue;
    if (Number(text(child(entity, 'identifier'))) !== filing.cik) throw new Error('The XBRL context identifies a different company.');
    const period = object(child(c, 'period'));
    const end = date(child(period, 'instant')) ?? date(child(period, 'endDate'));
    const start = date(child(period, 'startDate'));
    if (end) contexts.set(String(c['@_id']), { end, ...(start ? { start } : {}) });
  }
  const units = new Map<string, string>();
  for (const item of list(child(root, 'unit'))) {
    const unit = object(item); const measures = list(child(unit, 'measure'));
    if (child(unit, 'divide') !== undefined || measures.length !== 1) continue;
    const measure = text(measures[0]); const prefix = measure.split(':')[0]; const name = local(measure);
    if (name === 'shares' || /^[A-Z]{3}$/.test(name) && namespaces.get(prefix)?.includes('iso4217')) units.set(String(unit['@_id']), name);
  }
  const facts: NonNullable<CompanyFacts['filingFacts']> = []; const seen = new Set<string>();
  for (const [name, items] of Object.entries(root)) {
    if (name.startsWith('@_') || !usedTags.has(local(name))) continue;
    const ns = namespaces.get(name.split(':')[0]) ?? '';
    const taxonomy = /(?:fasb\.org|xbrl\.us)\/us-gaap\//.test(ns) ? 'us-gaap' : /xbrl\.sec\.gov\/dei\//.test(ns) ? 'dei' : null;
    if (!taxonomy) continue;
    for (const item of list(items)) {
      const fact = object(item); const period = contexts.get(String(fact['@_contextRef'])); const unit = units.get(String(fact['@_unitRef']));
      const value = text(item);
      if (!period || !unit || Object.entries(fact).some(([key, val]) => local(key) === 'nil' && ['true', '1'].includes(String(val))) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) continue;
      const val = Number(value); if (!Number.isFinite(val)) continue;
      const rawPrecision = fact['@_decimals'];
      const decimals = typeof rawPrecision === 'string' && /^-?\d+$/.test(rawPrecision) ? Number(rawPrecision) : rawPrecision === 'INF' ? 'INF' : null;
      const row = { tag: `${taxonomy}:${local(name)}`, unit, val, ...period, accn: filing.accession, filed: filing.filed, form: filing.form, url, retrievedAt, context: String(fact['@_contextRef']), decimals };
      const key = JSON.stringify([row.tag, period.start, period.end, unit, val, decimals]);
      if (!seen.has(key)) { seen.add(key); facts.push(row); }
    }
  }
  if (!facts.length) throw new Error('The filing has no supported consolidated financial facts.');
  return facts;
}
