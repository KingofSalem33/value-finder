# On-demand verification

Model: `fcff-2.1.0`. Checked on November 2-3, 2026. This record separates software proof from accounting completeness and forecast accuracy.

## Automated checks

- 89 TypeScript tests pass. They include the prior FCFF, WACC, TTM, bridge, currency/share, missing-value and independent Decimal checks.
- The runtime XBRL parser agrees with the independent EdgarTools extract for all used facts in AMD's latest annual and quarterly source instances. Tests also check negative amounts, reported zero, nil exclusion, dimensions, issuer identity, precision and unsafe entity declarations.
- On-demand tests cover symbols outside the regression set, source errors, mismatched CIKs, cache isolation and coalescing, source timestamps, latest-period guards, amendments without extracted XBRL, background cache progress, streamed error handling, abortable SEC queue deadlines and margin-of-safety arithmetic.
- TypeScript checks and the read-only unused-code check pass.
- Final code review reports no actionable findings. Earlier findings about amendments, background progress, live verification, source-URL typing and queue deadlines were fixed and checked.
- Persistent source entries use bounded gzip encoding. A real repeated JPM request preserved the original source timestamp and completed in 0.37 seconds after a 3.59-second first request. Tests cover financial inputs above 5 MB and bypass persistence when incompressible data exceeds the storage limit. This fixes the oversized-entry warning found in the final development log check.
- The existing seven archived records remain an offline regression gate. They do not supply stock-search results.

## Source retrieval

Direct on-demand retrieval and calculation passed for AMD, AAPL, MSFT, TXN, AGX, AMZN, NVDA and COST. CAT retained its specialized-model refusal. JNJ retrieved financials but did not produce a value because complete supported EBIT and debt inputs were missing. This is an accounting-review outcome, not evidence that the business has no value.

The initial eight operating-company calculations agreed with their existing engine outputs under the same current inputs where comparable. No model was tuned to a vendor price target. Inputs and reports are retained in ignored `output/on-demand`.

Company Facts supplies standard history. The runtime parser reads the latest annual and subsequent quarterly extracted XBRL, including current-period amendments. Amendments without extracted XBRL retain an explicit review finding. Custom concepts do not receive an automatic economic interpretation.

## Browser checks

The local browser passed an NVDA lookup outside the archived set, visible real progress, price independence, a 20.0% estimated margin of safety at a price equal to 80% of modeled value, a negative margin at a price above value, analyst growth edits, invalid WACC withholding and recovery, and automatic reset. The page had no horizontal overflow at 390 by 844 pixels. No browser console errors were recorded in the measured flow. All eleven local API cases passed the on-demand verifier, including eight valuations, two specialized-model refusals and JNJ accounting review.

The browser extension's date-field fill needed a native keyboard change to commit its input. The committed date updated the price and margin normally. No source workaround was added for this automation behavior. Browser checks do not establish physical-phone behavior.

## Deployment checks

Run `npm run verify:live` for the current production site, or set `VERIFY_URL` for a test deployment. It checks the model version, on-demand origin, source capture hashes, source provenance, expected valuation/refusal outcomes, FCFF and terminal identities, independent scenarios, and server/client calculation parity. Unlike the prior verifier, it does not require live source timestamps or digests to equal an archived record.

The SEC contact is stored as a server-only secret in Vercel Production and Preview. Environment access through the connector returned 403; the authenticated project dashboard saved and confirmed the setting. The actual contact is excluded from Git and the public source ZIP.

Final live deployment results are written to ignored `output/verification/live-report.json`. A local browser result or direct-source check is not a live deployment result.

## Limits

Search has no seven-company allowlist. A value still requires sufficient comparable history, supported accounting inputs, USD statements, a supported listed-share basis, and a documented industry reference. Banks, insurers, REITs, unresolved share classes and foreign issuers require additional methods or review.

No automatic output receives VERIFIED INPUTS. Company guidance is not automatically aggregated. Industry proxies, omitted claims, capital-plan duration, segment forecasts, complete CFO-to-FCFF reconciliation, and forecast accuracy remain review items. Treasury, ERP and industry inputs use visible dated captures and stale-reference findings; their refresh still requires a separate release. Market prices are manual. Physical-phone behavior and future scheduled execution timing remain unproven.

Prior release evidence is retained in [VERIFICATION-v1.md](VERIFICATION-v1.md) and [VERIFICATION-v2.md](VERIFICATION-v2.md).
