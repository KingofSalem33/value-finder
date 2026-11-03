# Refactor verification

Checked on 2026-11-02. Model: `fcff-2.0.0`.

The prior live release record is retained in [VERIFICATION-v1.md](VERIFICATION-v1.md). Its production and six-company checks do not establish proof for this refactor.

## Proven behavior

- 75 TypeScript tests pass. They cover the prior valuation checks plus actual AMD filing extracts, D&A component handling, matching-period growth, debt and lease scope, blank allocations, reference parsing, record acceptance, audit states, and saved provenance.
- Five Python parser tests pass in the isolated Python 3.13 environment. They check units, dates, context, precision, segment exclusion, reported zeros, loss signs, issuer matching, and the contact-identity guard.
- TypeScript checks pass. Collector dependencies pass `pip check`.
- `npm run build` passes, including all tests, the accepted-record gate, and the Next.js production build.
- All seven accepted records pass source-hash, issuer, model-version, and calculation checks. Six produce a valuation. CAT retains its specialized-model refusal.
- Terminal reinvestment, terminal value, the equity bridge, and share value agree with cached cells in Damodaran's published `fcffsimpleginzu.xlsx`. The source hash, cells, and values are retained in `tests/damodaran-benchmark.json`.
- The independent Decimal DCF test remains valid. It imports no application calculation code.

## Source evidence

EdgarTools 5.62.1 parsed AMD's original extracted XBRL instances for the 2025 annual report and the quarter ended 2026-06-27. The issuer's investor-relations site supplied the original filing files. The test extract retains source URLs and body hashes.

The extracted TTM revenue is $41.305 billion. TTM D&A is $3.073 billion: $3.050 billion annual D&A, plus $427 million other D&A and $1.095 billion intangible amortization in current YTD, less $364 million and $1.135 billion in prior comparable YTD. This is an extraction and arithmetic check. It does not establish an appropriate normalized profit margin or investment forecast.

Treasury and Damodaran reference retrieval succeeded. The Treasury observation is dated 2026-11-02. Monthly implied ERP is dated 2026-11-01. Industry tables are dated January 2026. Their original bodies are archived with source hashes. The monthly ERP source reports a different Treasury basis from the current observation. Both values are retained, and a material difference produces an audit finding.

Argan's dated earnings release explicitly reports no debt for 2026-07-31. A period-specific rule records that disclosure. It does not infer zero borrowings for a future period or zero contingent obligations.

## Failure chain

The prior AMD path was: ticker search → research API → standard-tag normalization → initial forecast rules → FCFF engine → displayed estimate.

Two input and policy faults are proven. The normalizer missed separately reported D&A components. The forecast compared TTM revenue with annual revenue and treated the result as the recent growth trend. The prior growth cap and margin policy also affected the output. Industry capital productivity remains an assumption that needs company research.

The entered market price is not an input to the independent FCFF value. Tests confirm price independence. Changing the quote feed cannot repair these accounting and forecast-policy faults. The refactor has not been tuned to match a published target.

## Browser evidence

Playwright checked the local app through an import of AMD's actual filing extract and matching SEC company metadata. This extract has three comparable annual revenue periods. It is not the required five-annual-filing collection and was not accepted into the production registry.

Passed checks:

- Import and display of the actual filing extract.
- Intrinsic-value independence from entered prices of $100 and $250.
- Immediate recalculation after an analyst growth edit.
- Invalid WACC rejection and recovery to calculated WACC.
- Blank CapEx when working-capital allocation is unavailable.
- Visible nested D&A source components.
- Local saving, export, and validation of the export.
- No page overflow at 390 × 844 pixels.
- No page exceptions during the measured flow.

Browser emulation does not establish physical-phone behavior. Development-server restart messages were outside the measured flow. Artifacts remain in ignored `output/refactor-qa`.

## Release gate and remaining proof

The full SEC collection passed for AMD, AAPL, MSFT, CAT, TXN, AGX, and AMZN. Each record includes ten annual periods from Company Facts and facts parsed from five annual filings plus the latest subsequent quarterly filing. Original source bodies are archived. The accepted run is recorded in `src/data/collection-report.json`.

GitHub-hosted [run 41546039256](https://github.com/KingofSalem33/value-finder/actions/runs/41546039256) passed collection, parser tests, calculation tests, record acceptance, source packaging, and the production build. It committed the accepted records. This proves one manual hosted run; it does not prove future schedule timing or automatic deployment.

The production deployment of source commit `cb84b26` passed all seven live API checks. Model version, input digests, collection timestamps, scenario calculations, and price independence matched the accepted records. The public source ZIP and an archived AMD collected-source record matched their local hashes. Unsupported symbols returned 404; malformed symbols returned 400, both with an error message.

The production browser passed AMD search, manual-price independence, analyst growth edits, automatic reset, invalid WACC withholding and recovery, and CAT's specialized-model refusal. At 390 by 844 pixels, the page had no horizontal overflow. No page exceptions occurred during the measured AMD checks. Physical-phone behavior remains unproven. Each later deployment must repeat the live parity check.

Still required:

1. Connect the existing Vercel project for automatic Git deployment before relying on a scheduled data commit to update the site. Current releases use explicit deployments of accepted commits.
2. Verify each deployment with `npm run verify:live`. This checks live model version, record digests, collection times, calculations, and expected coverage against the accepted local records. It writes its report to ignored `output/verification/live-report.json`.
3. Verify a scheduled run and physical-phone behavior separately.

No Git-triggered deployment is claimed. No automatic output receives VERIFIED INPUTS. Full CFO-to-FCFF reconciliation, investment duration, segment forecasts, normalization schedules, current company credit yields, and dated professional fair-value comparisons remain analyst review items.
