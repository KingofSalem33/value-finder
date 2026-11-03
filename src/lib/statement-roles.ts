import { load } from 'cheerio';
import type { Metric } from './types';

export interface StatementRole { metric: Metric; label: string }
export const statementKey = (tag: string, context: string) => `${tag}:${context}`;

/** Classify source rows, not numbers. Values and contexts still come from XBRL. */
export function statementRoles(html: string): Map<string, StatementRole> {
  const $ = load(html);
  const roles = new Map<string, StatementRole>();
  const conflicts = new Set<string>();
  const text = (value: string) => value.toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/[’']/g, '').replace(/\s+/g, ' ').trim().replace(/[\s$]+$/, '');
  const tables = $('table').toArray().map(table => {
    const rows = $(table).find('tr').toArray().filter(row => $(row).closest('table')[0] === table).map(row => {
      const cells = $(row).children('td, th');
      const firstFact = $(row).find('*').toArray().find(node => node.type === 'tag' && node.name.toLowerCase() === 'ix:nonfraction');
      if (!firstFact) return { label: text(cells.text()), facts: [] };
      const factCell = $(firstFact).closest('td, th')[0];
      const label = text(cells.toArray().slice(0, cells.toArray().findIndex(cell => cell === factCell)).map(cell => $(cell).text()).join(' '));
      const facts = $(row).find('*').toArray().filter(node => node.type === 'tag' && node.name.toLowerCase() === 'ix:nonfraction').map(node => ({ tag: $(node).attr('name') ?? '', context: $(node).attr('contextref') ?? '' }));
      return { label, facts };
    });
    const labels = rows.map(row => row.label);
    const balance = labels.includes('total assets') && labels.includes('total current liabilities') && labels.some(label => /^total (?:liabilities and|stockholders|shareholders|equity)/.test(label));
    const cashflow = labels.some(label => /net cash.*operating activities/.test(label)) && labels.some(label => /net cash.*investing activities/.test(label)) && labels.some(label => /net cash.*financing activities/.test(label));
    return { rows, balance, cashflow };
  });
  for (const kind of ['balance', 'cashflow'] as const) {
    const matches = tables.filter(table => table[kind]);
    // Multiple matching statements could be parent/subsidiary or guarantor accounts.
    if (matches.length !== 1) continue;
    for (const { label, facts } of matches[0].rows) {
      let metric: Metric | undefined;
      if (kind === 'balance') {
        if (label === 'cash and cash equivalents') metric = 'cash';
        if (/^(?:short-term debt(?: obligations)?|debt due within one year|notes payable and other borrowings,? current)$/.test(label)) metric = 'debtCurrent';
        if (/^(?:long-term debt(?: obligations)?(?:,? net of current portion)?|notes payable and other borrowings,? non-current)$/.test(label)) metric = 'debtNoncurrent';
      } else if (/^(?:purchases? of|additions to|payments (?:for|to acquire)) property,? (?:plant and |and )equipment$/.test(label)) metric = 'capex';
      if (!metric) continue;
      for (const fact of facts) {
        if (!fact.tag || !fact.context) continue;
        const key = statementKey(fact.tag, fact.context);
        const previous = roles.get(key);
        if (previous && previous.metric !== metric) { roles.delete(key); conflicts.add(key); }
        if (!conflicts.has(key)) roles.set(key, { metric, label });
      }
    }
  }
  return roles;
}
