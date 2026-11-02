# Research data ownership

## End state

A ticker search reads an accepted research record. It makes no upstream financial request. Each material fact has source metadata. Each forecast assumption has a visible basis. The same engine calculates server and analyst results.

## Owners

| Responsibility | Owner |
| --- | --- |
| SEC downloads and local XBRL parsing | `scripts/collect.py` |
| Treasury, monthly ERP, industry and credit captures | `scripts/refresh-references.ts` |
| Period matching, fact selection, D&A, debt scope | `src/lib/normalize.ts` |
| Eligibility, forecast rules, assumption explanations | `src/lib/research.ts` |
| FCFF, WACC, terminal value, scenarios, reverse DCF | `src/lib/valuation.ts` |
| Candidate validation and atomic acceptance | `scripts/build-records.ts` |
| Release record and source-hash checks | `scripts/verify-records.ts` |
| Headline audit state | `src/lib/status.ts` |

## Data flow

1. The collector retrieves SEC source bodies. Content hashes name deterministic gzip archives in `public/filings`.
2. EdgarTools parses local XBRL instances through its public facts API. Dimensional facts are excluded from the consolidated numeric record. Missing amounts are not created.
3. TypeScript selects and normalizes facts. It combines compatible components and retains all derivation inputs.
4. Dated references and disclosed policies produce initial assumptions. The valuation engine calculates cash flows and outputs.
5. The acceptance script checks all covered companies before it replaces the single deployed JSON registry.
6. The API returns the deployed record. Analyst edits use the same valuation engine locally.

The collector never decides that two accounting concepts mean the same thing. The accounting module owns that decision. A second parser, database, or provider fallback is not required for this version.

## Failure behavior

- A source, parse, hash, or accounting failure prevents acceptance. The prior deployed record remains available with its original date.
- A symbol outside collected coverage gets a specific coverage response.
- Missing facts produce an accounting-review state, not a zero amount.
- Unsupported business structures receive a specialized-model refusal.
- Invalid analyst assumptions produce a model error without crashing the page.
- Unknown investment allocations remain blank. The total reinvestment assumption remains visible.
- A dated qualitative accounting rule applies only to its specified period and source.

## Version boundaries

`MODEL_VERSION` must change when formulas or default policies change. The collector schema and parser version are recorded separately. Parser upgrades require filing checks. Published records must match the engine version.

Source archives contain public financial documents and numeric data only. SEC contact details stay in process or job settings. No request headers are archived. The public application has no provider keys.

## Proof limits

Calculation tests establish arithmetic under stated inputs. Source-hash checks establish byte identity with retained captures. Parser tests establish selected extraction behavior. None establishes complete accounting coverage or accurate forecasts. `VERIFIED INPUTS` is not assigned automatically.
