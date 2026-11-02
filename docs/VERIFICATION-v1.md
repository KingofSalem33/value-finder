# Verification record

Checked on 2026-11-02. This record covers software behavior and arithmetic. It is not an independent accounting opinion or a validation of forecast accuracy.

## Automated checks

50 tests cover annual and fiscal YTD matching, amendments, missing values, TTM cash flows, share-day weighting, sign and currency errors, share changes, debt composition, model eligibility, WACC, FCFF, capital-spending sensitivity, terminal reinvestment, equity claims, explicit share/ADR conversion arithmetic, scenarios, reverse DCF, price independence, invalid analyst edits and saved-file validation.

The independent Python Decimal calculation imports no application code. Its test-only annual schedule produces enterprise value 2370.5745248647408103 and equity value 2235.5745248647408103 in synthetic units. TypeScript agrees within 0.0000001 unit. These numbers are never used as company data.

TypeScript and a Next.js production build pass. The final cleanup check has no unused-file or unused-export findings. No paid provider is needed.

## Live SEC checks

| Symbol | Latest extracted period | Result |
| --- | --- | --- |
| AAPL | TTM 2026-06-27 | Forecast available; provisional inputs |
| MSFT | TTM 2026-09-30 | Forecast available; provisional inputs |
| CAT | TTM 2026-06-30 | Value withheld: incomplete standard-tag debt basis |
| TXN | TTM 2026-09-30 | Forecast available; provisional inputs |
| AGX | TTM 2026-07-31 | Value withheld: incomplete standard-tag debt basis |
| AMZN | TTM 2026-09-30 | Forecast available despite negative reported FCF; provisional inputs |

For the four available models, checks cover yearly cash-flow identity, terminal growth/reinvestment identity, server/TypeScript agreement, distinct scenario cash flows and independence from the entered stock price. All six checks distinguish a usable model from a safe refusal.

SEC access works from the deployed Vercel host. Direct companyfacts access from the development machine returned HTTP 403. FRED requests from Vercel timed out, so the deployed model uses a dated primary-source capture. The capture was retrieved on 2026-11-02; the latest available Treasury observation was 2026-10-29. Damodaran industry data is dated January 2026; the country/ERP table is dated January 5, 2026. These dates are visible in the application. Refresh is required before the Treasury observation becomes stale.

## Browser checks

Desktop and 390 × 844 mobile layouts were checked in Chromium through Playwright because the built-in browser was disabled. The mobile page has no page-level horizontal overflow. Financial tables have their own horizontal scroll regions.

The browser checks covered ticker submission, disclosed sources and dates, manual price/date entry, reverse DCF, analyst growth edits, immediate recalculation, intrinsic-value independence from price, local saving and restoration, JSON export and import, and the responsive summary. The browser reported no console errors in the checked flow. This is browser-emulated mobile proof; physical-device behavior has not been checked.

## Boundaries

No output is classified VERIFIED INPUTS by the automatic pipeline. Company credit yields, custom-tag completeness, options and other omitted claims, management guidance, segment economics and original-filing accounting discrepancies need independent review. No dated professional target comparison is claimed. The model has not been tuned to match a vendor target. Its automatic stress cases and forecast rules are not calibrated probability forecasts.

The current public deployment uses manual market prices. A free personal quote key would not establish permission for public redistribution.

Run `npm run verify:live` to create a new live record. Source facts and dates can change after this check.
