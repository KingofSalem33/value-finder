# Research data ownership

## End state

A stock search resolves a SEC-listed company, retrieves or reuses source inputs, then runs the accounting checks and valuation engine. Search is not restricted to archived regression records. Each fact retains its original source and reporting metadata. Each forecast assumption has a visible basis.

## Owners

| Responsibility | Owner |
| --- | --- |
| SEC directory, submissions, financials, filing selection, source bounds and pacing | `src/lib/sec.ts` |
| Extracted XBRL facts, contexts, units, precision and dimension exclusion | `src/lib/xbrl.ts` |
| Exact primary-statement row classification for missing cash, debt and CapEx | `src/lib/statement-roles.ts` |
| Next.js persistent input cache | `src/lib/sec.server.ts` |
| Fiscal matching, amendments, D&A, debt scope and TTM | `src/lib/normalize.ts` |
| Eligibility, forecast policy and industry-reference choice | `src/lib/research.ts`, `src/lib/sources.ts`, `src/data/industry-map.json` |
| FCFF, WACC, terminal value, scenarios, reverse DCF and margin of safety | `src/lib/valuation.ts` |
| NDJSON transport and source-error display | `src/app/api/research/route.ts`, `src/lib/research-stream.ts` |
| Dated Treasury, ERP, industry and credit captures | `scripts/refresh-references.ts` |
| Independent EdgarTools collection and original source archives | `scripts/collect.py` |
| Offline regression record acceptance and checks | `scripts/build-records.ts`, `scripts/verify-records.ts` |
| Live source and calculation checks | `scripts/check-on-demand.ts`, `scripts/verify-live.ts` |

## Search flow

1. Validate the symbol and resolve the SEC CIK and exchange. Verify the symbol again against submissions.
2. Read recent filing metadata. The latest relevant accessions identify the financial-input cache key.
3. Retrieve Company Facts and the latest annual and subsequent quarterly extracted XBRL. Include amendments for these periods. Qualitative accounting rules require their exact dated disclosure.
4. Exclude dimensional facts and unsupported custom concepts. Preserve reported zeros, losses, units, context and precision. If cash, debt or CapEx is missing, read the original SEC statement labels. A single identifiable statement and an exact supported row label can classify an existing numeric XBRL fact by tag and context. Multiple matching statements do not receive a guessed classification. The original tag and value remain unchanged; the HTML source also retains its hash and retrieval time.
5. The existing TypeScript accounting owner selects periods and facts. A newer reported period that cannot be normalized prevents a value.
6. The forecast owner selects dated industry references and explains each policy. The same engine calculates server and analyst results.
7. Stream actual acquisition progress and the result. Save/export retains selected financial evidence, assumptions, source metadata, model version and price date.

## Cache boundaries

The directory has a 24-hour TTL. Submissions have a five-minute TTL. Compact financial bundles have a one-hour TTL and include the selected accession fingerprint. A new filing chooses a new bundle. Parsed instances have a 30-day TTL keyed by accession. A bounded process cache coalesces reads; Next.js supplies persistent caching. Persistent entries use gzip encoding capped at 1.5 MB; larger encoded entries bypass storage without changing or dropping their financial values. Source timestamps remain the time of actual retrieval. Progress callbacks do not run inside persistent cache refresh work.

Original on-demand HTTP bodies are hashed but are not durably archived. Saved/exported evidence makes the selected model inputs reproducible. Separate offline regression captures retain original source bodies under `public/filings`. No database or Python web service is used.

The persistent cache namespace is `sec-on-demand-3`. It separates the statement-reader input format from prior cached bundles. Statement-label retrieval is optional: a failed read preserves the XBRL and the unresolved input remains unavailable.

## Failure and scope boundaries

- Unknown symbols return a specific lookup error. Source failures retain their HTTP error class or timeout state.
- A failed or mismatched source is not replaced with fabricated values or an old company valuation.
- Missing amounts remain missing. Industry mappings are documented proxies; an unmapped industry requires review.
- Specialized firms and unsupported currencies/share classes do not receive generic FCFF values.
- A nonfinancial amendment with no extracted instance does not erase usable base facts; the result explicitly requires amendment review.
- Invalid analyst assumptions withhold the value. A negative estimated margin of safety indicates a price above the estimate.
- The seven-company archive remains test evidence. It is not a search allowlist or a runtime fallback.

The website requires the server-only `SEC_USER_AGENT` contact. It has no public quote-provider key. Reference captures are released separately and their dates remain visible. Existing workflow data commits do not automatically deploy the unlinked Vercel project.

## Proof limits

Tests establish specified arithmetic and extraction behavior. Source hashes identify captured bytes. Neither proves full accounting coverage, sustainable forecast assumptions or future investment returns. VERIFIED INPUTS is not assigned automatically.
